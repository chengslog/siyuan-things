/**
 * IndexedDB 工具层——仅用于启动时检查并迁移残留数据。
 * 主存储已回退到思源文件存储（可被同步），IDB 仅用于一次性清理。
 */

const DB_NAME = "siyuan-things";
const DB_VERSION = 1;

export const IDB_STORES = ["tasks", "projects", "areas", "tags", "settings"] as const;
export type IDBStoreName = (typeof IDB_STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of IDB_STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbGetAll<T = any>(store: IDBStoreName): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function idbClear(store: IDBStoreName): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Inspect old caches without creating, upgrading, clearing or merging them. */
export async function inspectLegacyIDB(): Promise<Record<string, unknown[]>> {
  if (typeof indexedDB === 'undefined') return {};
  if (typeof indexedDB.databases !== 'function') {
    throw new Error('当前客户端无法只读核对旧版缓存，请在新版思源桌面端完成首次数据库初始化。');
  }
  const databases = await indexedDB.databases();
  if (!databases.some(db => db.name === DB_NAME)) return {};
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => { request.transaction?.abort(); };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    request.onblocked = () => { blocked = true; reject(new Error('旧版缓存被其他窗口占用，请关闭该窗口后重试。')); };
  });
  try {
    const result: Record<string, unknown[]> = {};
    for (const name of IDB_STORES) {
      if (!db.objectStoreNames.contains(name)) continue;
      result[name] = await new Promise((resolve, reject) => {
        const request = db.transaction(name, 'readonly').objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }
    return result;
  } finally { db.close(); }
}
