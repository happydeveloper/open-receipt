// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 단체 공간에서 두 기기의 기록을 합치는 규칙. 서버 없이 테스트할 수 있는 순수 함수만 둔다.
 *
 * - 같은 id의 기록은 updatedAt이 더 최근인 쪽을 고른다.
 * - 지운 기록은 삭제 기록(tombstone)으로 남겨, 다른 기기의 옛 사본이 되살리지 못하게 한다.
 *   단, 지운 뒤에 다른 기기에서 다시 고친 기록은 살린다.
 * - 사진은 문서에 넣지 않고 IMAGE_REF 표시만 둔다. 사진은 건별로 따로 올린다.
 */
import { isPhoto, mapPhotos, photosOf } from "./photos";
import { withStatus } from "./status";
import type { Ledger } from "./ledger";
import type { Expense } from "./types";

/** 삭제 기록: 지운 기록의 id → 지운 시각. 다른 기기에서 되살아나지 않게 한다. */
export type Tombstones = Record<string, string>;
export interface SharedSettings {
  org: string;
  projects: string[];
  funder: string;
  approver: string;
  /** 후원자용 보기 링크를 켰는지 */
  sponsorView?: boolean;
  /** 후원자용 보기에서 사람 이름을 보여 줄지 */
  sponsorNames?: boolean;
}
export interface SyncDoc {
  v: 1;
  expenses: Expense[];
  tombstones: Tombstones;
  shared: SharedSettings;
  sharedAt: string;
  /** 기기별 서명 원장. 모든 구성원 기기가 사본을 가진다. */
  ledger?: Ledger;
}
/** 영수증 이미지는 따로 올리므로 문서에는 자리표시만 둔다. */
export const IMAGE_REF = "sync:image";

const time = (s?: string) => (s ? Date.parse(s) || 0 : 0);

/** 바뀐 기록에 시각을 찍는다. 이전 목록과 내용이 같은 기록은 그대로 둔다. */
export function touchChanged(prev: Expense[], next: Expense[], now = new Date().toISOString()): Expense[] {
  const before = new Map(prev.map((e) => [e.id, JSON.stringify({ ...e, updatedAt: undefined })]));
  return next.map((e) => (before.get(e.id) === JSON.stringify({ ...e, updatedAt: undefined }) && e.updatedAt ? e : { ...e, updatedAt: now }));
}

/** 두 기기의 기록을 합친다. 같은 기록은 더 최근에 바뀐 쪽을, 삭제는 삭제 이후에 바뀌지 않았을 때만 적용한다. */
export function mergeExpenses(local: Expense[], remote: Expense[], localTombs: Tombstones, remoteTombs: Tombstones): { expenses: Expense[]; tombstones: Tombstones } {
  const tombstones: Tombstones = { ...remoteTombs };
  for (const [id, at] of Object.entries(localTombs)) if (time(at) > time(tombstones[id])) tombstones[id] = at;
  const byId = new Map<string, Expense>();
  for (const e of remote) byId.set(e.id, e);
  for (const e of local) {
    const other = byId.get(e.id);
    if (!other || time(e.updatedAt) >= time(other.updatedAt)) byId.set(e.id, e);
  }
  const expenses: Expense[] = [];
  for (const e of byId.values()) {
    const deletedAt = tombstones[e.id];
    if (deletedAt && time(deletedAt) >= time(e.updatedAt)) continue;
    if (deletedAt) delete tombstones[e.id]; // 삭제 뒤에 다시 고친 기록은 살린다
    expenses.push(withStatus(e));
  }
  return { expenses, tombstones };
}

/** 문서에 넣을 때 이미지를 자리표시로 바꾼다. */
export function stripImages(list: Expense[]): Expense[] {
  // "local:image"는 사진을 아직 불러오지 못한 기기의 표시다. 다른 기기에는 자리표시로 넘긴다.
  return list.map((e) => mapPhotos(e, (img) => (isPhoto(img) || img === "local:image" ? IMAGE_REF : img)));
}
/** 내려받은 문서의 자리표시를 이 기기가 가진 이미지로 되돌린다. 없는 것은 자리표시로 남는다. have의 키는 사진 이름(lib/photos.ts)이다. */
export function restoreImages(list: Expense[], have: Map<string, string>): Expense[] {
  return list.map((e) => mapPhotos(e, (img, key) => (img === IMAGE_REF && have.has(key) ? have.get(key) : img)));
}
/** 이 기기가 가진 사진 전부 (사진 이름 → 사진). 영수증과 함께 묶은 자료를 모두 담는다. */
export function imagesOf(list: Expense[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of list) for (const p of photosOf(e)) m.set(p.key, p.image);
  return m;
}
