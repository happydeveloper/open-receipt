// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 단체 공간에서 두 기기의 기록을 합치는 규칙. 서버 없이 테스트할 수 있는 순수 함수만 둔다.
 *
 * - 같은 id의 기록은 칸 단위로 합친다. 바탕은 updatedAt이 더 최근인 쪽이고, 다른 쪽이 더 나중에 고친 칸은 그 값을 쓴다.
 * - 지운 기록은 삭제 기록(tombstone)으로 남겨, 다른 기기의 옛 사본이 되살리지 못하게 한다.
 *   단, 지운 뒤에 다른 기기에서 다시 고친 기록은 살린다.
 * - 사진은 문서에 넣지 않고 IMAGE_REF 표시만 둔다. 사진은 건별로 따로 올린다.
 */
import { fieldLabel, showValue } from "./history";
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
  /** 등록자도 승인할 수 있게 할지 */
  submitterApproves?: boolean;
  /** 예산: 사업 이름 → 예산 항목 → 금액 */
  budgets?: Record<string, Record<string, number>>;
  /** 마감한 사업 (lib/closing.ts). 다른 설정과 달리 사업마다 나중 것이 남도록 따로 합친다 */
  closed?: Record<string, { at: string; by: string; open?: boolean }>;
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
/** 기기 시계가 서버보다 이만큼 넘게 앞서 찍은 시각은 믿지 않는다. */
export const FUTURE_SLACK_MS = 5 * 60_000;
/**
 * 서버 시각보다 한참 뒤로 찍힌 시각을 서버 시각으로 되돌린다.
 * 시계가 빠른 기기가 고친 값에는 "미래"의 시각이 찍혀, 다른 기기가 나중에 아무리 고쳐도 계속 이겼다.
 * 서버와 맞출 때마다 이런 시각을 서버의 지금으로 끌어내리면, 그 뒤에 고친 값이 정상적으로 이긴다.
 */
export function clampFuture(list: Expense[], serverNow: string): Expense[] {
  const limit = time(serverNow) + FUTURE_SLACK_MS;
  if (!time(serverNow)) return list;
  const late = (s?: string) => time(s) > limit;
  return list.map((e) => {
    const stamps = Object.entries(e.fieldAt ?? {});
    if (!late(e.updatedAt) && !stamps.some(([, at]) => late(at))) return e;
    return { ...e, updatedAt: late(e.updatedAt) ? serverNow : e.updatedAt, ...(stamps.length ? { fieldAt: Object.fromEntries(stamps.map(([f, at]) => [f, late(at) ? serverNow : at])) } : {}) };
  });
}

/** 서버가 한 번에 받는 문서(암호문)의 길이. 서버(lib/sync-store.ts)와 기기가 같은 값을 쓴다. */
export const DOC_LIMIT = 3_000_000;

/**
 * 문서에 싣기 전에 기록을 가볍게 한다: 검색 결과 가운데 "확인할 자료"에 실제로 연결된 것만 남기고,
 * 화면에 쓰지 않는 긴 설명은 뺀다. 지출 한 건에 검색 결과 여덟 건의 설명이 붙어 있어 기록의 절반을 차지했다.
 */
export function slimGuidance(list: Expense[]): Expense[] {
  return list.map((e) => {
    if (!e.guidance?.sources.length) return e;
    const used = new Set(e.guidance.checklist.map((c) => c.sourceUrl));
    const sources = e.guidance.sources.filter((s) => used.has(s.url)).map((s) => (s.description ? { ...s, description: "" } : s));
    return sources.length === e.guidance.sources.length && sources.every((s, i) => s === e.guidance!.sources[i]) ? e : { ...e, guidance: { ...e.guidance, sources } };
  });
}

/** 영수증 이미지는 따로 올리므로 문서에는 자리표시만 둔다. */
export const IMAGE_REF = "sync:image";

const time = (s?: string) => (s ? Date.parse(s) || 0 : 0);

/** 내용에 해당하는 칸. 승인자가 본 내용이 바뀌었는지 따질 때도 이 목록을 쓴다. */
const CONTENT = ["date", "item", "amount", "merchant", "purpose", "project", "budgetCategory", "paymentMethod", "payer", "reimbursement", "evidence", "summary"] as const;
/** 칸 단위로 합치는 칸. 승인(approvedBy, approvedAt)은 한 덩어리로 따로 다룬다. */
const FIELDS = [...CONTENT, "confirmed", "submittedBy", "guidance", "returned"] as const;
const APPROVAL = "approvedBy";
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const bare = (e: Expense) => JSON.stringify({ ...e, updatedAt: undefined, fieldAt: undefined });

/**
 * 바뀐 기록에 시각을 찍는다. 이전 목록과 내용이 같은 기록은 그대로 둔다.
 * 이미 있던 기록을 고쳤으면 어느 칸이 바뀌었는지도 칸별 시각(fieldAt)에 적는다.
 */
export function touchChanged(prev: Expense[], next: Expense[], now = new Date().toISOString()): Expense[] {
  const before = new Map(prev.map((e) => [e.id, e]));
  return next.map((e) => {
    const old = before.get(e.id);
    if (old && bare(old) === bare(e) && e.updatedAt) return e;
    if (!old) return { ...e, updatedAt: now };
    const fieldAt = { ...(e.fieldAt ?? {}) };
    for (const f of FIELDS) if (!same(old[f], e[f])) fieldAt[f] = now;
    if (!same([old.approvedBy, old.approvedAt], [e.approvedBy, e.approvedAt])) fieldAt[APPROVAL] = now;
    return { ...e, updatedAt: now, ...(Object.keys(fieldAt).length ? { fieldAt } : {}) };
  });
}

/**
 * 같은 기록의 두 사본을 칸 단위로 합친다.
 *
 * 바탕은 더 최근에 바뀐 사본(win)이다. 다른 사본(lose)이 어떤 칸을 win보다 나중에 고쳤다는 표시(fieldAt)가 있으면
 * 그 칸만 lose의 값으로 바꾼다. 그래서 총무가 목적을 고치고 승인자가 예산 항목을 고쳐도 둘 다 남는다.
 * 같은 칸을 둘 다 고쳤으면 나중에 고친 쪽이 남는다.
 *
 * 승인은 승인자가 본 내용에 대한 것이다. 합친 내용이 승인한 쪽이 갖고 있던 내용과 다르면 승인을 풀고 이력을 남긴다.
 */
export function mergeRecord(win: Expense, lose: Expense): { expense: Expense; mixed: boolean } {
  const stamp = (e: Expense, f: string) => time(e.fieldAt?.[f]);
  const out: any = { ...win, aiDrafted: [...win.aiDrafted] };
  const fieldAt: Record<string, string> = { ...(win.fieldAt ?? {}) };
  let mixed = false;
  const takes = (f: string) => stamp(lose, f) > 0 && stamp(lose, f) > stamp(win, f);
  // 두 기기가 같은 칸을 서로 다르게 고쳤으면 한쪽 값은 덮인다. 무엇이 남고 무엇이 덮였는지 이력에 적어 둔다.
  const clashes: { at: string; by: string; text: string }[] = [];
  for (const f of FIELDS) {
    if (stamp(win, f) > 0 && stamp(lose, f) > 0 && !same(win[f], lose[f]) && f !== "confirmed" && f !== "submittedBy" && f !== "guidance" && f !== "returned") {
      const [kept, dropped] = takes(f) ? [lose, win] : [win, lose];
      const a = showValue(kept, f), b = showValue(dropped, f);
      if (a !== b) clashes.push({ at: kept.fieldAt![f], by: "동기화", text: `${fieldLabel(f)}: 두 기기에서 함께 고쳐 나중에 고친 값(${a})을 남겼습니다. 덮인 값: ${b}` });
    }
    if (!takes(f)) continue;
    fieldAt[f] = lose.fieldAt![f];
    if (same(win[f], lose[f])) continue;
    out[f] = lose[f];
    mixed = true;
    // AI가 채운 값이라는 표시도 값을 가져온 쪽을 따른다.
    out.aiDrafted = out.aiDrafted.filter((k: string) => k !== f);
    if (lose.aiDrafted.includes(f)) out.aiDrafted.push(f);
  }
  let approvedFrom = win;
  if (takes(APPROVAL)) {
    fieldAt[APPROVAL] = lose.fieldAt![APPROVAL];
    if (!same([win.approvedBy, win.approvedAt], [lose.approvedBy, lose.approvedAt])) {
      out.approvedBy = lose.approvedBy;
      out.approvedAt = lose.approvedAt;
      approvedFrom = lose;
      mixed = true;
    }
  }
  // 이력은 양쪽 것을 모두 남긴다.
  const seen = new Set<string>();
  const log = [...(win.log ?? []), ...(lose.log ?? []), ...clashes].filter((l) => { const k = `${l.at}|${l.by}|${l.text}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => x.at.localeCompare(y.at));
  if (log.length) out.log = log.slice(-20);
  // 사진은 기기에 따라 자리표시일 수 있으므로, 사진이 있는지만 견준다.
  const seenBy = (e: Expense, f: (typeof CONTENT)[number]) =>
    f === "evidence" ? { ...e.evidence, image: !!e.evidence.image, extra: (e.evidence.extra ?? []).map((a) => ({ id: a.id, label: a.label })) } : e[f];
  if (mixed && out.approvedBy && CONTENT.some((f) => !same(seenBy(out, f), seenBy(approvedFrom, f)))) {
    const at = [win.updatedAt, lose.updatedAt].sort().at(-1) ?? "";
    out.log = [...(out.log ?? []), { at, by: out.approvedBy, text: `승인한 뒤 다른 기기에서 내용이 바뀌어 승인이 풀렸습니다 (이전 승인: ${out.approvedBy})` }].slice(-20);
    out.approvedBy = undefined;
    out.approvedAt = undefined;
  }
  if (Object.keys(fieldAt).length) out.fieldAt = fieldAt;
  return { expense: out as Expense, mixed };
}

/**
 * 두 기기의 기록을 합친다. 같은 기록은 칸 단위로 합치고(mergeRecord), 삭제는 삭제 이후에 바뀌지 않았을 때만 적용한다.
 * merged에는 양쪽 수정이 섞여 어느 쪽 사본과도 달라진 기록의 id가 담긴다.
 */
export function mergeExpenses(local: Expense[], remote: Expense[], localTombs: Tombstones, remoteTombs: Tombstones): { expenses: Expense[]; tombstones: Tombstones; merged: string[] } {
  const tombstones: Tombstones = { ...remoteTombs };
  for (const [id, at] of Object.entries(localTombs)) if (time(at) > time(tombstones[id])) tombstones[id] = at;
  const byId = new Map<string, Expense>();
  const merged: string[] = [];
  for (const e of remote) byId.set(e.id, e);
  for (const e of local) {
    const other = byId.get(e.id);
    if (!other) { byId.set(e.id, e); continue; }
    const [win, lose] = time(e.updatedAt) >= time(other.updatedAt) ? [e, other] : [other, e];
    const m = mergeRecord(win, lose);
    byId.set(e.id, m.expense);
    if (m.mixed) merged.push(e.id);
  }
  const expenses: Expense[] = [];
  for (const e of byId.values()) {
    const deletedAt = tombstones[e.id];
    if (deletedAt && time(deletedAt) >= time(e.updatedAt)) continue;
    if (deletedAt) delete tombstones[e.id]; // 삭제 뒤에 다시 고친 기록은 살린다
    expenses.push(withStatus(e));
  }
  return { expenses, tombstones, merged: merged.filter((id) => expenses.some((e) => e.id === id)) };
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
