// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 같은 거래의 서류 묶기 (규칙 부분).
 *
 * 카드영수증, 거래명세서, 주문 화면 캡처를 따로 올리면 지출이 세 건으로 잡힌다.
 * 묶음 에이전트(lib/agent.ts의 runGroupAgent)가 Liner 모델로 "이 서류들은 한 거래로 보인다"고 제안하고,
 * 사람이 받아들이면 이 파일의 mergeGroup이 한 건으로 합친다.
 *
 * 에이전트는 제안만 한다. 합치는 것은 사람이 누를 때만 일어나고, 제안은 코드가 다시 검증한다
 * (없는 기록, 승인된 기록, 두 묶음에 겹친 기록은 버린다).
 */
import { softenJudgment } from "./guard";
import { isPhoto, newAttachmentId, photoKey, slotsOf } from "./photos";
import { addLog, withStatus } from "./status";
import { PAYMENT_LABEL, type Attachment, type Expense } from "./types";

/** 서류 종류. 지출 에이전트가 사진을 읽을 때 함께 적는다. */
export const DOC_TYPES = ["카드영수증", "간이영수증", "거래명세서", "주문내역", "이체확인증", "견적서", "기타"] as const;
export const normalizeDocType = (v: unknown): string => ((DOC_TYPES as readonly string[]).includes(String(v)) ? String(v) : "");
// 대표로 삼기 좋은 순서: 결제를 증명하는 서류가 먼저다.
const MAIN_ORDER = ["카드영수증", "간이영수증", "", "이체확인증", "거래명세서", "주문내역", "견적서", "기타"];

/** 묶음 에이전트에 보내는 서류 한 장의 요약. 사진은 보내지 않는다. */
export interface GroupDoc {
  id: string;
  date: string;
  amount: number | null;
  merchant: string;
  item: string;
  payment: string;
  /** 서류 종류. 모르면 빈 문자열 */
  docType: string;
  /** 이 기록에 붙은 사진 수 */
  photos: number;
}
export interface GroupProposal {
  ids: string[];
  /** 남길 기록. 나머지는 이 기록의 자료로 붙는다 */
  mainId: string;
  /** 에이전트가 적은 이유 */
  reason: string;
  /** 서류끼리 어긋나는 점 (금액은 코드가 직접 견줘 적는다) */
  mismatch: string;
}

/** 합칠 수 있는 기록인지: 아직 승인되지 않았고, 사진이 있으며, 그 사진을 이 기기가 모두 갖고 있다. */
export function groupable(e: Expense): boolean {
  const slots = slotsOf(e);
  return !e.approvedBy && slots.length > 0 && slots.every((s) => isPhoto(s.image));
}
export function toGroupDocs(list: Expense[]): GroupDoc[] {
  return list.filter(groupable).slice(0, 60).map((e) => ({
    id: e.id, date: e.date, amount: e.amount, merchant: e.merchant, item: e.item,
    payment: e.paymentMethod ? PAYMENT_LABEL[e.paymentMethod] : "", docType: e.evidence.docType ?? "", photos: slotsOf(e).length,
  }));
}
/** 대표 기록 고르기: 결제를 증명하는 서류를 먼저, 같으면 앞에 있는 것. */
export function pickMain(docs: GroupDoc[]): string {
  const rank = (d: GroupDoc) => { const i = MAIN_ORDER.indexOf(d.docType); return i < 0 ? MAIN_ORDER.length : i; };
  return [...docs].sort((a, b) => rank(a) - rank(b))[0]?.id ?? "";
}
/** 금액이 서로 다르면 그 사실을 적는다. 같으면 빈 문자열. */
export function amountMismatch(docs: GroupDoc[]): string {
  const amounts = [...new Set(docs.map((d) => d.amount).filter((a): a is number => typeof a === "number" && a > 0))];
  return amounts.length > 1 ? `금액이 서로 다릅니다: ${amounts.map((a) => `${a.toLocaleString("ko-KR")}원`).join(", ")}` : "";
}

/**
 * 모델이 낸 제안을 검증해 쓸 수 있는 것만 남긴다.
 * 두 장 이상이어야 하고, 모두 받은 서류 목록에 있어야 하며, 한 서류는 한 묶음에만 든다.
 */
export function cleanProposals(raw: unknown, docs: GroupDoc[]): GroupProposal[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const used = new Set<string>();
  const out: GroupProposal[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const given: string[] = (Array.isArray(p?.ids) ? p.ids : []).map((x: unknown) => String(x));
    const ids = [...new Set(given)].filter((id) => byId.has(id) && !used.has(id));
    if (ids.length < 2) continue;
    const members = ids.map((id) => byId.get(id)!);
    for (const id of ids) used.add(id);
    const said = softenJudgment(String(p?.mismatch ?? "").trim().slice(0, 200)).text;
    out.push({
      ids,
      mainId: ids.includes(String(p?.mainId)) ? String(p.mainId) : pickMain(members),
      reason: softenJudgment(String(p?.reason ?? "").trim().slice(0, 300)).text || "날짜, 금액, 가맹점이 서로 맞습니다.",
      mismatch: [amountMismatch(members), said].filter(Boolean).join(" · "),
    });
  }
  return out;
}

/** 이미 검증된 제안 가운데, 지금도 모든 서류가 합칠 수 있는 상태로 남아 있는 것만 고른다. */
export function stillValid(groups: unknown, docs: GroupDoc[]): GroupProposal[] {
  const ids = new Set(docs.map((d) => d.id));
  return (Array.isArray(groups) ? groups : []).filter((g): g is GroupProposal =>
    Array.isArray(g?.ids) && g.ids.length >= 2 && g.ids.every((id: unknown) => typeof id === "string" && ids.has(id)) && g.ids.includes(g.mainId) && typeof g.reason === "string" && typeof g.mismatch === "string");
}

const FILL = ["date", "amount", "merchant", "item", "purpose", "project", "budgetCategory", "paymentMethod", "payer"] as const;
const empty = (v: unknown) => v === null || v === undefined || v === "";

export interface MergeResult {
  merged: Expense;
  /** 합쳐져 사라지는 기록의 id */
  removed: string[];
  /** 원본 사진을 옮길 자리 (예전 사진 이름 → 새 사진 이름) */
  moves: { from: string; to: string }[];
}
/**
 * 여러 기록을 한 건으로 합친다. main이 남고, others의 사진은 main의 자료로 붙는다.
 * main의 빈 칸은 others에서 읽힌 값으로 채운다 (이미 있는 값은 바꾸지 않는다).
 * 금액은 더하지 않는다. 같은 거래의 서류이기 때문이다.
 */
export function mergeGroup(main: Expense, others: Expense[], by: string, newId: () => string = newAttachmentId, at: string = new Date().toISOString()): MergeResult {
  const next: any = { ...main, aiDrafted: [...main.aiDrafted], approvedBy: undefined, approvedAt: undefined };
  const extra: Attachment[] = [...(main.evidence.extra ?? [])];
  const moves: MergeResult["moves"] = [];
  for (const o of others) {
    for (const s of slotsOf(o)) {
      if (!isPhoto(s.image)) continue;
      const id = newId();
      extra.push({ id, label: s.main ? o.evidence.docType || s.label : s.label, image: s.image, ...(s.original ? { original: true } : {}) });
      if (s.original) moves.push({ from: s.key, to: photoKey(main.id, id) });
    }
    for (const f of FILL) {
      if (!empty(next[f]) || empty(o[f])) continue;
      next[f] = o[f];
      if (o.aiDrafted.includes(f) && !next.aiDrafted.includes(f)) next.aiDrafted.push(f);
    }
    if (next.reimbursement === "unknown" && o.reimbursement !== "unknown") next.reimbursement = o.reimbursement;
    if (!next.summary && o.summary) next.summary = o.summary;
    if (!next.guidance && o.guidance) next.guidance = o.guidance;
  }
  next.evidence = { ...main.evidence, extra };
  const merged = addLog(withStatus(next), by, `같은 거래의 서류 ${others.length + 1}건을 한 건으로 합쳤습니다 (${[main, ...others].map((e) => e.evidence.docType || e.item || "서류").join(", ")})`, at);
  return { merged, removed: others.map((o) => o.id), moves };
}
