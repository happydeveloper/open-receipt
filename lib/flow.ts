// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 화면의 기록과 에이전트가 돌려준 기록을 합치는 규칙.
 *
 * "사람이 넣은 값"과 "AI가 채운 값"을 필드 단위로 구분한다.
 * - 값이 있고 aiDrafted에 없는 필드는 사람이 넣은 것으로 보고 잠근다(lockedFields).
 * - 에이전트 결과를 반영할 때 잠긴 필드는 덮어쓰지 않는다(applyAgentRecord).
 * - 사람이 AI 초안을 고치면 그 필드의 AI 초안 표시를 지운다(editField).
 */
import { withStatus } from "./status";
import type { Expense } from "./types";

/** 사람이 값을 고치면 그 필드의 "AI 초안" 표시를 지운다. */
export function editField<K extends keyof Expense>(e: Expense, key: K, value: Expense[K]): Expense {
  return withStatus({ ...e, [key]: value, aiDrafted: e.aiDrafted.filter((k) => k !== key) });
}

/** 에이전트 없이 직접 입력했을 때 쓰는 요약 문장. */
export function fallbackSummary(e: Expense): string {
  const pay =
    e.paymentMethod === "personal"
      ? `${e.payer || "담당자"} 개인 선결제${e.reimbursement === "needed" ? ", 환급 요청" : ""}`
      : e.paymentMethod === "org_card"
        ? "조직카드 결제"
        : e.paymentMethod === "transfer"
          ? "계좌이체"
          : e.paymentMethod === "cash"
            ? "현금 결제"
            : "";
  return [`${e.project ? e.project + " " : ""}${e.purpose || e.item} 지출.`, pay ? pay + "." : ""].filter(Boolean).join(" ");
}

/* ---------- 에이전트 연동 ---------- */

export const AGENT_FIELDS = ["date", "amount", "merchant", "item", "paymentMethod", "purpose", "project", "budgetCategory", "payer", "reimbursement"] as const;
type AgentField = (typeof AGENT_FIELDS)[number];

/** 에이전트에 보낼 현재 기록 값 (미확인 환급은 뺀다). */
export function recordValues(e: Expense): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const f of AGENT_FIELDS) {
    const v = (e as any)[f];
    if (v === null || v === undefined || v === "" || (f === "reimbursement" && v === "unknown")) continue;
    out[f] = v;
  }
  return out;
}

/** 사람이 직접 넣은 필드 = 값이 있고 AI 초안 표시가 없는 필드. 에이전트가 덮어쓰지 못한다. */
export function lockedFields(e: Expense): string[] {
  return Object.keys(recordValues(e)).filter((f) => !e.aiDrafted.includes(f));
}

/** 에이전트가 돌려준 기록을 반영한다. 확정 여부와 승인은 건드리지 않는다. */
export function applyAgentRecord(e: Expense, record: Record<string, unknown>, aiFields: string[], summary = ""): Expense {
  const next: any = { ...e, aiDrafted: [...e.aiDrafted] };
  const locked = new Set(lockedFields(e));
  for (const f of AGENT_FIELDS as readonly AgentField[]) {
    if (!(f in record) || record[f] === null || record[f] === undefined) continue;
    // 서버도 잠긴 필드는 건드리지 않으므로, 돌아온 값은 사람이 넣은 값 그대로다. 받되 AI 초안 표시는 붙이지 않는다.
    if (locked.has(f) && !aiFields.includes(f)) {
      next[f] = record[f];
      continue;
    }
    // 잠긴 필드인데 AI가 채웠다고 온 값은 받지 않는다 (서버 규칙을 화면에서 한 번 더 지킨다).
    if (locked.has(f)) continue;
    next[f] = record[f];
    if (aiFields.includes(f) && !next.aiDrafted.includes(f)) next.aiDrafted.push(f);
  }
  if (summary) {
    next.summary = summary;
    if (!next.aiDrafted.includes("summary")) next.aiDrafted.push("summary");
  }
  return withStatus(next);
}
