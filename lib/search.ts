// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 지출 목록에서 찾기와 거르기.
 * 찾는 말은 띄어쓰기로 나눠 모두 들어 있는 기록만 남긴다. 항목, 가맹점, 목적, 결제자, 예산 항목, 요약, 날짜, 금액에서 찾는다.
 */
import type { Expense, Status } from "./types";

export interface ListFilter {
  /** 찾는 말. 비어 있으면 모두 */
  q: string;
  /** 상태. "all"이면 모두 */
  status: Status | "all";
}
export const NO_FILTER: ListFilter = { q: "", status: "all" };
export const isFiltering = (f: ListFilter) => f.q.trim() !== "" || f.status !== "all";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** 금액은 "26400", "26,400", "26,400원" 어느 쪽으로 찾아도 맞게 숫자만 견준다. */
const digits = (s: string) => s.replace(/[^\d]/g, "");

export function filterExpenses(list: Expense[], f: ListFilter): Expense[] {
  const words = norm(f.q).split(" ").filter(Boolean);
  return list.filter((e) => {
    if (f.status !== "all" && e.status !== f.status) return false;
    if (!words.length) return true;
    const text = norm([e.item, e.merchant, e.purpose, e.payer, e.budgetCategory, e.summary, e.date, e.submittedBy, (e.evidence.extra ?? []).map((a) => a.label).join(" "), (e.amount ?? 0) < 0 ? "환불" : ""].join(" "));
    const amount = String(Math.abs(e.amount ?? 0));
    return words.every((w) => text.includes(w) || (digits(w).length >= 3 && digits(w) === w.replace(/[,원]/g, "") && amount.includes(digits(w))));
  });
}
