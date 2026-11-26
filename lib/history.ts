// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 고친 내용을 변경 이력에 남기기.
 *
 * 확정된 기록을 고치면 어느 칸이 무엇에서 무엇으로 바뀌었는지를 기록의 이력(log)에 한 줄로 적는다.
 * 두 기기가 같은 칸을 고쳐 한쪽 값이 덮였을 때도, 무엇이 남고 무엇이 덮였는지 적는다(lib/sync-merge.ts).
 * 이력은 기록과 함께 모든 기기에 전해지므로, 누가 무엇을 고쳤는지 나중에 서로 확인할 수 있다.
 */
import { evidenceLabel } from "./csv";
import { addLog } from "./status";
import { PAYMENT_LABEL, REIMB_LABEL, type Expense } from "./types";

/** 이력에 남기는 칸과 화면에 쓰는 이름. */
export const TRACKED: [keyof Expense, string][] = [
  ["date", "일자"], ["amount", "금액"], ["merchant", "가맹점"], ["item", "항목"], ["purpose", "목적"], ["project", "사업·행사"],
  ["budgetCategory", "예산 항목"], ["paymentMethod", "결제 방식"], ["payer", "결제자"], ["reimbursement", "환급 여부"], ["evidence", "증빙"],
];
const LABEL = new Map<string, string>(TRACKED.map(([k, v]) => [k as string, v]));
export const fieldLabel = (f: string) => LABEL.get(f) ?? f;
const clip = (s: string) => (s.length > 30 ? `${s.slice(0, 29)}…` : s);

/** 칸의 값을 사람이 읽는 글로. 빈 값은 "없음". */
export function showValue(e: Expense, f: keyof Expense): string {
  const v = e[f];
  if (f === "amount") return typeof v === "number" ? `${v.toLocaleString("ko-KR")}원` : "없음";
  if (f === "paymentMethod") return v ? PAYMENT_LABEL[v as keyof typeof PAYMENT_LABEL] : "없음";
  if (f === "reimbursement") return REIMB_LABEL[e.reimbursement];
  if (f === "evidence") return clip(evidenceLabel(e) + (e.evidence.reason ? ` · ${e.evidence.reason}` : ""));
  return v === null || v === undefined || v === "" ? "없음" : clip(String(v));
}

/** 두 사본 사이에 바뀐 칸을 "이름: 예전 → 지금" 문장으로 돌려준다. 보이는 값이 같으면 넣지 않는다. */
export function describeChanges(before: Expense, after: Expense): string[] {
  const out: string[] = [];
  for (const [f, label] of TRACKED) {
    const a = showValue(before, f), b = showValue(after, f);
    if (a !== b) out.push(`${label}: ${a} → ${b}`);
  }
  return out;
}

/**
 * 이미 확정되어 있던 기록을 고쳤으면 무엇을 고쳤는지 이력에 남긴다.
 * 초안을 채워 가는 동안의 변경은 남기지 않는다 (아직 누구에게도 내놓지 않은 내용이다).
 */
export function logEdits(prev: Expense[], next: Expense[], by: string, at: string = new Date().toISOString()): Expense[] {
  const before = new Map(prev.map((e) => [e.id, e]));
  return next.map((e) => {
    const old = before.get(e.id);
    if (!old || !old.confirmed || old === e) return e;
    const changes = describeChanges(old, e);
    return changes.length ? addLog(e, by, `고쳤습니다. ${changes.join(", ")}`, at) : e;
  });
}
