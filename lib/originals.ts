// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 원본 영수증 보관함. 원본은 용량이 커서 브라우저의 IndexedDB에 따로 둔다.
 * AI에는 보내지 않으며, 단체 공간을 쓰면 구성원(등록자·승인자)에게만 암호화해 공유한다.
 */
export interface ImageBag {
  get(id: string): Promise<string | null>;
  put(id: string, data: string): Promise<void>;
  del(id: string): Promise<void>;
}

const DB = "open-receipt";
const STORES = ["originals", "masked"] as const;
type StoreName = (typeof STORES)[number];

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T | null>((res, rej) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      req.onsuccess = () => res((req.result as T) ?? null);
      req.onerror = () => rej(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null; // 사생활 보호 모드 등 IndexedDB를 못 쓰는 환경
  }
}
const bag = (store: StoreName): ImageBag => ({
  get: (id) => run<string>(store, "readonly", (s) => s.get(id)),
  put: async (id, data) => void (await run(store, "readwrite", (s) => s.put(data, id))),
  del: async (id) => void (await run(store, "readwrite", (s) => s.delete(id))),
});

/** 이 기기의 원본 보관함. */
export const deviceOriginals: ImageBag = bag("originals");
/** 이 기기의 가린 사진 보관함. 사진은 용량이 커서 기록 목록과 따로 둔다. */
export const deviceMasked: ImageBag = bag("masked");

/** 테스트용 보관함. */
export function memoryBag(): ImageBag & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (id) => data.get(id) ?? null, put: async (id, d) => void data.set(id, d), del: async (id) => void data.delete(id) };
}
