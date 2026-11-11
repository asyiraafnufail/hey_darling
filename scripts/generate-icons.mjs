import fs from 'node:fs';
import zlib from 'node:zlib';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (~c) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function isInsideHeart(nx, ny) {
  // Normalized coordinates [-1.3, 1.3] with y flipped upright
  const x = nx * 1.35;
  const y = -ny * 1.35 + 0.12;
  const a = x * x + y * y - 0.55;
  return a * a * a - x * x * y * y * y <= 0;
}

function createHeartPng(width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB

  const rowSize = 1 + width * 3;
  const rawData = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    const ny = (y / height) * 2 - 1;
    for (let x = 0; x < width; x++) {
      const nx = (x / width) * 2 - 1;
      const p = rowOffset + 1 + x * 3;
      if (isInsideHeart(nx, ny)) {
        rawData[p] = 233;
        rawData[p + 1] = 64;
        rawData[p + 2] = 109;
      } else {
        rawData[p] = 26;
        rawData[p + 1] = 26;
        rawData[p + 2] = 26;
      }
    }
  }

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(rawData)),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

if (!fs.existsSync('icons')) {
  fs.mkdirSync('icons', { recursive: true });
}

fs.writeFileSync('icons/icon-192.png', createHeartPng(192, 192));
fs.writeFileSync('icons/icon-512.png', createHeartPng(512, 512));
fs.writeFileSync('icons/apple-touch-icon.png', createHeartPng(180, 180));
