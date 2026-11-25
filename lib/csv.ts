// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * CSV 내보내기. 합계, 날짜순 정렬, 증빙 표시 문구는 결산보고서(lib/report.ts)도 함께 쓴다.
 */
import { openItems } from "./status";
import { PAYMENT_LABEL, REIMB_LABEL, STATUS_LABEL, type Expense } from "./types";

export const BOM = "﻿";
export const CSV_HEADERS = ["날짜", "항목", "금액", "사업·행사", "예산 항목", "목적", "가맹점", "결제 방식", "결제자", "환급", "증빙", "상태", "확인할 항목", "요약"];

// 쉼표, 따옴표, 줄바꿈이 든 값은 따옴표로 감싼다 (RFC 4180).
const cell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** 증빙 칸에 쓰는 문구. CSV와 결산보고서가 함께 쓴다. */
export function evidenceLabel(e: Expense): string {
  const base = e.evidence.kind === "receipt" ? (e.evidence.image ? "영수증 첨부" : "영수증 미첨부") : e.evidence.kind === "alternative" ? `대체 증빙(${e.evidence.altType || "사유서"})` : "없음";
  // 함께 묶은 자료(거래명세서 등)가 있으면 종류를 덧붙인다.
  const extra = (e.evidence.extra ?? []).map((a) => a.label).join(", ");
  if (!extra) return base;
  return base === "없음" || base === "영수증 미첨부" ? `${extra} 첨부` : `${base} + ${extra}`;
}
export function totalAmount(list: Expense[]): number {
  return list.reduce((s, e) => s + (e.amount ?? 0), 0);
}
export function sortByDate(list: Expense[]): Expense[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.item.localeCompare(b.item));
}

/** 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다. 마지막 행은 합계. */
export function toCsv(list: Expense[]): string {
  const rows = sortByDate(list).map((e) => [
    e.date,
    e.item,
    e.amount ?? "",
    e.project,
    e.budgetCategory,
    e.purpose,
    e.merchant,
    e.paymentMethod ? PAYMENT_LABEL[e.paymentMethod] : "",
    e.payer,
    REIMB_LABEL[e.reimbursement],
    evidenceLabel(e),
    STATUS_LABEL[e.status],
    openItems(e).map((o) => o.text).join(" / "),
    e.summary,
  ]);
  const total = ["합계", "", totalAmount(list), ...Array(CSV_HEADERS.length - 3).fill("")];
  return BOM + [CSV_HEADERS, ...rows, total].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
