// Minimal in-memory IndexedDB shim for testing src/db.js natively in Node.js
export function createMockIndexedDB() {
  const stores = new Map();

  function makeRequest(executor) {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    queueMicrotask(() => {
      try {
        req.result = executor();
        req.onsuccess?.({ target: req });
      } catch (err) {
        req.error = err;
        req.onerror?.({ target: req });
      }
    });
    return req;
  }

  function makeStore(storeName) {
    if (!stores.has(storeName)) {
      stores.set(storeName, { data: new Map(), keyPath: null, indexes: new Map() });
    }
    const storeState = stores.get(storeName);

    return {
      createIndex(name, keyPath) {
        storeState.indexes.set(name, keyPath);
      },
      put(item) {
        return makeRequest(() => {
          const key = item[storeState.keyPath];
          storeState.data.set(key, structuredClone(item));
          return key;
        });
      },
      get(key) {
        return makeRequest(() => {
          const val = storeState.data.get(key);
          return val ? structuredClone(val) : undefined;
        });
      },
      getAll() {
        return makeRequest(() => Array.from(storeState.data.values()).map((v) => structuredClone(v)));
      },
      index(indexName) {
        const keyPath = storeState.indexes.get(indexName);
        return {
          openCursor(range, direction = 'next') {
            const req = { result: null, error: null, onsuccess: null, onerror: null };
            const items = Array.from(storeState.data.values())
              .filter((item) => {
                if (!range) return true;
                const val = item[keyPath];
                if (range.upper !== undefined) {
                  return range.upperOpen ? val < range.upper : val <= range.upper;
                }
                return true;
              })
              .sort((a, b) => {
                if (a[keyPath] === b[keyPath]) return 0;
                const cmp = a[keyPath] < b[keyPath] ? -1 : 1;
                return direction === 'prev' ? -cmp : cmp;
              });

            let idx = 0;
            function step() {
              queueMicrotask(() => {
                if (idx < items.length) {
                  const val = structuredClone(items[idx]);
                  req.result = {
                    value: val,
                    continue() {
                      idx++;
                      step();
                    },
                  };
                } else {
                  req.result = null;
                }
                req.onsuccess?.({ target: req });
              });
            }
            step();
            return req;
          },
        };
      },
    };
  }

  const db = {
    objectStoreNames: {
      contains(name) {
        return stores.has(name);
      },
    },
    createObjectStore(name, opts) {
      stores.set(name, { data: new Map(), keyPath: opts.keyPath, indexes: new Map() });
      return makeStore(name);
    },
    transaction(storeNames) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const tx = {
        oncomplete: null,
        onerror: null,
        objectStore(name) {
          if (!names.includes(name)) throw new Error(`Unknown store: ${name}`);
          return makeStore(name);
        },
      };
      queueMicrotask(() => tx.oncomplete?.({ target: tx }));
      return tx;
    },
  };

  return {
    open() {
      const req = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (!stores.has('messages')) {
          req.onupgradeneeded?.({ target: req });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}
