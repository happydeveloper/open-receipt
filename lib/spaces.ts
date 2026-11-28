// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 공간: 한 기기에서 여러 장부를 따로 쓴다.
 *
 * 공간마다 기록, 설정, 단체 공간 연결(초대 링크), 서명 원장, 사진이 따로다. 서로 섞이지 않는다.
 * 단체가 여럿이거나, 사업마다 다른 사람들과 나눠 쓰고 싶을 때 공간을 더 만든다.
 *
 * 저장은 이름표로 나눈다. 첫 공간(자리 이름 "")은 예전부터 쓰던 이름 그대로 두어 옮길 것이 없고,
 * 나머지 공간은 저장 이름 뒤에 "@자리"를 붙인다. 사진 보관함은 이름 앞에 "자리/"를 붙인다.
 */
import { LEDGER_KEY } from "./ledger";
import type { ImageBag } from "./originals";
import { slotsOf } from "./photos";
import { BACKUP_KEY, SETTINGS_KEY, normalizeSettings } from "./settings";
import { STORAGE_KEY, type KV } from "./storage";
import { inviteCode, isLocked } from "./sync-crypto";
import { loadMeta, SYNC_KEY } from "./sync-client";

export const SPACES_KEY = "open-receipt:spaces:v1";
/** 한 기기에 둘 수 있는 공간 수. 브라우저 저장 공간이 작아서 넉넉히 두지 않는다 */
export const SPACE_MAX = 12;
/** 공간마다 따로 두는 저장 이름 */
export const SPACE_KEYS = [STORAGE_KEY, SETTINGS_KEY, SYNC_KEY, LEDGER_KEY, BACKUP_KEY];

export interface Space {
  /** 저장 자리 이름. 첫 공간은 "" */
  slot: string;
  createdAt: string;
}
export interface Spaces {
  /** 지금 열려 있는 공간의 자리 이름 */
  active: string;
  list: Space[];
}
const FIRST: Space = { slot: "", createdAt: "" };

/** 무엇이 들어오든 공간 목록 모양으로 다듬는다. 목록은 비지 않고, 열린 공간은 늘 목록 안에 있다. */
export function normalizeSpaces(raw: unknown): Spaces {
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const seen = new Set<string>();
  const list: Space[] = [];
  for (const s of Array.isArray(r.list) ? r.list : []) {
    const slot = typeof s?.slot === "string" ? s.slot : null;
    if (slot === null || !/^[a-z0-9]{0,16}$/.test(slot) || seen.has(slot)) continue;
    seen.add(slot);
    list.push({ slot, createdAt: typeof s.createdAt === "string" ? s.createdAt : "" });
  }
  if (!list.length) list.push({ ...FIRST });
  const active = typeof r.active === "string" && seen.has(r.active) ? r.active : list[0].slot;
  return { active, list: list.slice(0, SPACE_MAX) };
}
export function loadSpaces(kv: Pick<KV, "getItem">): Spaces {
  try {
    return normalizeSpaces(JSON.parse(kv.getItem(SPACES_KEY) ?? "null"));
  } catch {
    return normalizeSpaces(null);
  }
}
export function saveSpaces(kv: Pick<KV, "setItem">, s: Spaces): boolean {
  try {
    kv.setItem(SPACES_KEY, JSON.stringify(normalizeSpaces(s)));
    return true;
  } catch {
    return false;
  }
}

/** 새 자리 이름 (소문자와 숫자 8자). */
export function newSlot(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
/** 공간을 하나 더하고 그 공간을 연다. 꽉 찼으면 그대로 돌려준다. */
export function addSpace(s: Spaces, slot: string, now = new Date().toISOString()): Spaces {
  if (s.list.length >= SPACE_MAX || s.list.some((x) => x.slot === slot)) return s;
  return { active: slot, list: [...s.list, { slot, createdAt: now }] };
}
export function openSpace(s: Spaces, slot: string): Spaces {
  return s.list.some((x) => x.slot === slot) ? { ...s, active: slot } : s;
}
/** 목록에서 공간을 뺀다. 하나 남은 공간은 빼지 않는다. 열려 있던 공간을 빼면 남은 첫 공간이 열린다. */
export function dropSpace(s: Spaces, slot: string): Spaces {
  if (s.list.length < 2 || !s.list.some((x) => x.slot === slot)) return s;
  const list = s.list.filter((x) => x.slot !== slot);
  return { active: s.active === slot ? list[0].slot : s.active, list };
}

/** 저장 이름에 공간의 이름표를 붙인다. */
export const spaceKey = (key: string, slot: string) => (slot ? `${key}@${slot}` : key);
/** 한 공간만 보이는 저장소. 공간 목록 자체(SPACES_KEY)는 어느 공간에서나 같은 것을 본다. */
export function scopedKV(kv: KV, slot: string): KV {
  if (!slot) return kv;
  const k = (key: string) => (key === SPACES_KEY ? key : spaceKey(key, slot));
  return { getItem: (key) => kv.getItem(k(key)), setItem: (key, v) => kv.setItem(k(key), v), removeItem: (key) => kv.removeItem(k(key)) };
}
/** 한 공간만 보이는 사진 보관함. 자리 이름은 쓸 때마다 물어서, 브라우저 밖(서버 렌더링)에서 만들어 두어도 된다. */
export function scopedBag(bag: ImageBag, slot: () => string): ImageBag {
  const k = (id: string) => (slot() ? `${slot()}/${id}` : id);
  return { get: (id) => bag.get(k(id)), put: (id, data) => bag.put(k(id), data), del: (id) => bag.del(k(id)) };
}

export interface SpaceInfo {
  slot: string;
  /** 단체 이름. 아직 정하지 않았으면 "" */
  org: string;
  /** 기록 건수 */
  count: number;
  /** 단체 공간에 연결되어 있는지 */
  connected: boolean;
  /** 암호로 잠근 단체 공간인지 */
  locked: boolean;
  /** 초대 링크의 # 뒤. 연결되지 않았으면 "" */
  invite: string;
  /** 연결된 단체 공간의 이름표. 같은 공간에 두 번 참여하지 않게 견주는 데 쓴다 */
  workspaceId: string;
}
/** 공간 목록 화면에 보일 한 줄. 그 공간의 저장소를 읽기만 한다. */
export function describeSpace(kv: KV, slot: string): SpaceInfo {
  const own = scopedKV(kv, slot);
  let org = "", count = 0;
  try { org = normalizeSettings(JSON.parse(own.getItem(SETTINGS_KEY) ?? "null")).org; } catch { /* 깨진 설정은 이름 없는 공간으로 보인다 */ }
  try { const l = JSON.parse(own.getItem(STORAGE_KEY) ?? "[]"); count = Array.isArray(l) ? l.length : 0; } catch { /* 깨진 목록은 0건으로 보인다 */ }
  const ws = loadMeta(own).ws;
  return { slot, org, count, connected: !!ws, locked: !!ws && isLocked(ws), invite: ws ? inviteCode(ws) : "", workspaceId: ws?.id ?? "" };
}
/** 이 단체 공간에 이미 연결된 공간의 자리 이름. 없으면 null. */
export function spaceOfWorkspace(kv: KV, s: Spaces, workspaceId: string): string | null {
  return s.list.find((x) => describeSpace(kv, x.slot).workspaceId === workspaceId)?.slot ?? null;
}

/**
 * 한 공간이 이 기기에 둔 것을 모두 지운다 (기록, 설정, 연결, 원장, 사진).
 * 서버의 단체 공간과 다른 기기의 기록은 건드리지 않는다.
 */
export async function wipeSpace(kv: KV, slot: string, bags: ImageBag[]): Promise<void> {
  const own = scopedKV(kv, slot);
  let keys: string[] = [];
  try {
    const l = JSON.parse(own.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(l)) keys = l.flatMap((e: any) => (e && typeof e.id === "string" ? [e.id, ...slotsOf(e).map((s) => s.key)] : []));
  } catch { /* 목록을 읽지 못하면 사진은 남는다. 기록과 설정은 아래에서 지운다 */ }
  for (const bag of bags) {
    const mine = scopedBag(bag, () => slot);
    for (const k of new Set(keys)) await mine.del(k);
  }
  for (const k of SPACE_KEYS) own.removeItem(k);
}
