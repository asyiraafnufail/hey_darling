/**
 * Hey Darling: Modul Penyimpanan Lokal IndexedDB
 * Menyimpan riwayat pesan di sisi klien dan mengelola delta sync timestamp.
 */

const DB_NAME = 'hey_darling_db';
const DB_VERSION = 1;

export function createChatDB(customIdb = null) {
  let dbInstance = null;

  function getIdb() {
    if (customIdb) return customIdb;
    if (typeof indexedDB !== 'undefined') return indexedDB;
    throw new Error('IndexedDB API is not available in this environment');
  }

  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
      const idb = getIdb();
      const request = idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('messages')) {
          const messageStore = db.createObjectStore('messages', { keyPath: 'id' });
          messageStore.createIndex('created_at', 'created_at', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        reject(event.target.error || new Error('Failed to open IndexedDB'));
      };
    });
  }

  async function saveMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readwrite');
      const store = tx.objectStore('messages');
      let count = 0;

      for (const msg of messages) {
        if (!msg || !msg.id) continue;
        store.put({
          id: String(msg.id),
          sender_id: String(msg.sender_id),
          body: String(msg.body),
          created_at: String(msg.created_at),
          delivered_at: msg.delivered_at ? String(msg.delivered_at) : null,
          read_at: msg.read_at ? String(msg.read_at) : null,
        });
        count++;
      }

      tx.oncomplete = () => resolve(count);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getLocalMessages(limit = 50, beforeTimestamp = null) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('created_at');

      const messages = [];
      const range = beforeTimestamp
        ? (typeof IDBKeyRange !== 'undefined'
            ? IDBKeyRange.upperBound(beforeTimestamp, true)
            : { upper: beforeTimestamp, upperOpen: true })
        : null;

      // Iterasi mundur (prev) agar kita mendapatkan 'limit' pesan terbaru
      const request = index.openCursor(range, 'prev');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && messages.length < limit) {
          messages.push(cursor.value);
          cursor.continue();
        } else {
          // Balik kembali ke urutan kronologis menaik (asc) untuk tampilan chat
          resolve(messages.reverse());
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async function getLatestTimestamp() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(['messages'], 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('created_at');
      const request = index.openCursor(null, 'prev');

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        resolve(cursor ? cursor.value.created_at : null);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async function saveMeta(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['meta'], 'readwrite');
      const store = tx.objectStore('meta');
      store.put({ key: String(key), value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getMeta(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['meta'], 'readonly');
      const store = tx.objectStore('meta');
      const request = store.get(String(key));
      request.onsuccess = (event) => {
        const res = event.target.result;
        resolve(res ? res.value : null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  return {
    openDB,
    saveMessages,
    getLocalMessages,
    getLatestTimestamp,
    saveMeta,
    getMeta,
  };
}

// Default singleton instance untuk runtime browser
export const defaultDB = createChatDB();
export const openDB = defaultDB.openDB;
export const saveMessages = defaultDB.saveMessages;
export const getLocalMessages = defaultDB.getLocalMessages;
export const getLatestTimestamp = defaultDB.getLatestTimestamp;
export const saveMeta = defaultDB.saveMeta;
export const getMeta = defaultDB.getMeta;
