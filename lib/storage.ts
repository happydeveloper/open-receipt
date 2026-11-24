// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 지출 기록의 기기 저장.
 *
 * 기록 목록은 localStorage에 JSON으로 둔다. 영수증 사진은 용량이 커서 IndexedDB(lib/originals.ts)에
 * 따로 두고, 목록에는 LOCAL_IMAGE 표시만 남긴다. 불러올 때 hydrateImages로 사진을 다시 채운다.
 * 저장소를 KV, ImageStore 인터페이스로 받아서 테스트에서는 메모리 구현을 쓴다.
 */
import { seedExpenses } from "./seed";
import { withStatus } from "./status";
import type { Expense } from "./types";

export const STORAGE_KEY = "open-receipt:v1";
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** 기록 목록에서 사진 자리에 두는 표시. 사진 자체는 큰 저장소(IndexedDB)에 따로 둔다. */
export const LOCAL_IMAGE = "local:image";
export interface ImageStore {
  get(id: string): Promise<string | null>;
  put(id: string, data: string): Promise<void>;
}
// 자리표시(LOCAL_IMAGE, 1x1 그림)와 진짜 사진을 길이로 구분한다.
const isPhoto = (v?: string) => !!v && v.length > 200;

/** 저장된 기록 목록. 없거나 깨졌으면 null. 상태는 읽을 때 다시 계산한다. */
export function loadExpenses(kv: KV): Expense[] | null {
  try {
    const raw = kv.getItem(STORAGE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(withStatus) : null;
  } catch {
    return null;
  }
}
/**
 * 기록 목록을 저장한다. 사진 보관함을 주면 사진은 거기에 두고 목록에는 표시만 남긴다
 * (여러 장을 올려도 브라우저의 작은 저장 공간이 차지 않게).
 */
export function saveExpenses(kv: KV, list: Expense[], photos?: ImageStore): boolean {
  try {
    const slim = photos
      ? list.map((e) => {
          if (!isPhoto(e.evidence.image)) return e;
          void photos.put(e.id, e.evidence.image!);
          return { ...e, evidence: { ...e.evidence, image: LOCAL_IMAGE } };
        })
      : list;
    kv.setItem(STORAGE_KEY, JSON.stringify(slim));
    return true;
  } catch {
    return false;
  }
}
/** 불러온 목록의 사진 표시를 보관함의 실제 사진으로 되돌린다. */
export async function hydrateImages(list: Expense[], photos: ImageStore): Promise<Expense[]> {
  return Promise.all(
    list.map(async (e) => {
      if (e.evidence.image !== LOCAL_IMAGE) return e;
      const img = await photos.get(e.id);
      return img ? { ...e, evidence: { ...e.evidence, image: img } } : e;
    }),
  );
}
export function resetToSeed(kv: KV): Expense[] {
  const seed = seedExpenses();
  saveExpenses(kv, seed);
  return seed;
}
