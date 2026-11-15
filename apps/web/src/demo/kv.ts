/** Tiny async key-value store on IndexedDB (falls back to memory when the browser blocks it, e.g. some private windows). */
const DB = 'gridvue-demo', STORE = 'kv';
let dbp: Promise<IDBDatabase | null> | null = null;
const mem = new Map<string, unknown>();
function open(): Promise<IDBDatabase | null> {
  return (dbp ??= new Promise(res => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch { res(null); }
  }));
}
function wrap<T>(req: IDBRequest<T>): Promise<T> { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await open(); if (!db) return mem.get(key) as T | undefined;
    return wrap(db.transaction(STORE).objectStore(STORE).get(key)) as Promise<T | undefined>;
  },
  async set(key: string, value: unknown): Promise<void> {
    const db = await open(); if (!db) { mem.set(key, value); return; }
    await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
  },
  async del(key: string): Promise<void> {
    const db = await open(); if (!db) { mem.delete(key); return; }
    await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  },
  /** every value whose key starts with `prefix` */
  async list<T>(prefix: string): Promise<T[]> {
    const db = await open();
    if (!db) return [...mem.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v as T);
    return wrap(db.transaction(STORE).objectStore(STORE).getAll(IDBKeyRange.bound(prefix, prefix + '￿'))) as Promise<T[]>;
  },
};
