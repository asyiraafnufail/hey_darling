/**
 * Zero-dependency Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID ES256)
 * Menggunakan Web Crypto API standar (crypto.subtle) - berjalan di Deno & Node.js.
 */

function b64UrlToBytes(b64Url: string): Uint8Array {
  const pad = '='.repeat((4 - (b64Url.length % 4)) % 4);
  const b64 = (b64Url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(sig);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const stepInput = concatBytes(info, new Uint8Array([1]));
  const okm = await hmacSha256(prk, stepInput);
  return okm.slice(0, length);
}

export async function createVapidJwt(
  audience: string,
  subject: string,
  vapidPublicKeyB64: string,
  vapidPrivateKeyB64: string
): Promise<string> {
  const pubBytes = b64UrlToBytes(vapidPublicKeyB64);
  if (pubBytes.length !== 65 || pubBytes[0] !== 4) {
    throw new Error('Invalid VAPID public key format (expected 65-byte uncompressed P-256)');
  }

  const x = bytesToB64Url(pubBytes.slice(1, 33));
  const y = bytesToB64Url(pubBytes.slice(33, 65));
  const d = vapidPrivateKeyB64;

  const signingKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const header = bytesToB64Url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const claims = bytesToB64Url(new TextEncoder().encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const unsigned = `${header}.${claims}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${bytesToB64Url(new Uint8Array(signature))}`;
}

export async function encryptWebPushPayload(
  payloadText: string,
  userPublicKeyB64: string,
  userAuthB64: string
): Promise<Uint8Array> {
  const uaPubBytes = b64UrlToBytes(userPublicKeyB64);
  const authSecret = b64UrlToBytes(userAuthB64);
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  const asPubBytes = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));
  const uaPubKey = await crypto.subtle.importKey(
    'raw',
    uaPubBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asKeyPair.privateKey, 256)
  );

  const encoder = new TextEncoder();
  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const keyInfo = concatBytes(encoder.encode('WebPush: info\x00'), uaPubBytes, asPubBytes);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdfExpand(prk, encoder.encode('Content-Encoding: nonce\x00'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const paddedPlaintext = concatBytes(encoder.encode(payloadText), new Uint8Array([2]));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, paddedPlaintext)
  );

  // Header aes128gcm: salt(16) + rs(4 byte BE: 4096) + idlen(1: 65) + asPubBytes(65)
  const header = new Uint8Array(16 + 4 + 1 + asPubBytes.length);
  header.set(salt, 0);
  const view = new DataView(header.buffer);
  view.setUint32(16, 4096, false);
  header[20] = asPubBytes.length;
  header.set(asPubBytes, 21);

  return concatBytes(header, ciphertext);
}

export interface PushSubRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendWebPush(
  sub: PushSubRecord,
  payloadJson: Record<string, unknown>,
  vapid: { publicKey: string; privateKey: string; subject: string }
): Promise<Response> {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const jwt = await createVapidJwt(audience, vapid.subject, vapid.publicKey, vapid.privateKey);
  const encryptedBody = await encryptWebPushPayload(JSON.stringify(payloadJson), sub.p256dh, sub.auth);

  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Urgency: 'high',
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body: encryptedBody,
  });
}
