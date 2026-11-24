// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 지출 기록의 상태 규칙. 이 앱의 가장 중요한 약속이 여기 있다.
 *
 *   증빙 없음 → "증빙 보완"
 *   증빙 있음 + (확정 전 또는 필수 정보 빠짐) → "초안"
 *   확정함 + 승인 전 → "승인 대기"
 *   승인함 → "완료"
 *
 * 상태는 저장된 값이 아니라 기록 내용에서 계산한다(deriveStatus). 그리고 확정과 승인은
 * 사람이 누를 때만 일어난다(confirmExpense, approveExpense). 에이전트 코드는 이 두 함수를 부르지 않는다.
 *
 * 함께 들어 있는 것: 단체 공간의 승인 규칙(approvalBlock), 변경 이력(addLog),
 * 같은 영수증일 수 있는 기록 찾기(findDuplicates).
 */
import type { Expense, OpenItem, Status } from "./types";

/** 빈 기록을 만든다. 넘긴 값으로 덮어쓰고, 상태는 내용에서 다시 계산한다. */
export function newExpense(partial: Partial<Expense> = {}): Expense {
  const e: Expense = {
    id: partial.id ?? `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    date: "",
    item: "",
    amount: null,
    merchant: "",
    purpose: "",
    project: "",
    budgetCategory: "",
    paymentMethod: null,
    payer: "",
    reimbursement: "unknown",
    evidence: { kind: "none" },
    summary: "",
    confirmed: false,
    status: "draft",
    aiDrafted: [],
    submittedBy: "",
    ...partial,
  };
  return { ...e, status: deriveStatus(e) };
}

/** 증빙이 빠졌는지. 영수증은 사진이 있어야 하고, 대체 증빙은 사진이나 사유 중 하나가 있어야 한다. */
export function evidenceMissing(e: Expense): boolean {
  const ev = e.evidence;
  if (ev.kind === "receipt") return !ev.image;
  if (ev.kind === "alternative") return !ev.image && !(ev.reason ?? "").trim();
  return true;
}

/** 확정에 필요한데 아직 비어 있는 필드의 이름(화면 표시용). */
export function missingFields(e: Expense): string[] {
  const out: string[] = [];
  if (!e.date) out.push("일자");
  if (e.amount == null || !(e.amount > 0)) out.push("금액");
  if (!e.item.trim()) out.push("항목");
  if (!e.project.trim()) out.push("사업·행사");
  if (!e.paymentMethod) out.push("결제 방식");
  return out;
}

/** 상태는 사람의 행동(확정·승인)과 증빙 유무로만 정해진다. */
export function deriveStatus(e: Expense): Status {
  if (evidenceMissing(e)) return "needs_evidence";
  if (!e.confirmed || missingFields(e).length > 0) return "draft";
  if (e.approvedBy) return "done";
  return "pending_approval";
}

/** 판정이 아니라 "확인할 항목"과 다음 행동을 돌려준다. */
export function openItems(e: Expense): OpenItem[] {
  const items: OpenItem[] = [];
  if (evidenceMissing(e)) {
    items.push({
      code: "evidence",
      text: e.paymentMethod === "transfer" ? "이체확인증 또는 대체 증빙 첨부" : "영수증 또는 대체 증빙 첨부",
    });
  }
  const miss = missingFields(e);
  if (miss.length) items.push({ code: "fields", text: `필수 정보 입력: ${miss.join(", ")}` });
  const status = deriveStatus(e);
  if (status === "done") return items;
  if (status === "draft" && !e.confirmed && !miss.length) items.push({ code: "fields", text: "내용 확인 후 확정" });
  if (e.paymentMethod === "personal" && e.reimbursement !== "not_needed") {
    if (status === "pending_approval") items.push({ code: "approval", text: "환급 여부와 승인자 확인" });
    else if (e.reimbursement === "unknown") items.push({ code: "reimbursement", text: "환급 여부 확인" });
  } else if (status === "pending_approval") {
    items.push({ code: "approval", text: "승인자 확인" });
  }
  return items;
}

/** 상태를 내용에 맞게 다시 계산한 기록. 기록을 고친 뒤나 저장소에서 읽은 뒤에 거친다. */
export function withStatus(e: Expense): Expense {
  return { ...e, status: deriveStatus(e) };
}

/** 입력자의 확정. 사람이 누를 때만 호출한다. */
export function confirmExpense(e: Expense, by: string): Expense {
  return withStatus({ ...e, confirmed: true, submittedBy: by });
}

/** 이력은 최근 20줄만 남긴다. */
export function addLog(e: Expense, by: string, text: string, at: string = new Date().toISOString()): Expense {
  return { ...e, log: [...(e.log ?? []), { at, by, text }].slice(-20) };
}

/** 입력자의 확정. 승인된 기록을 고쳐 다시 확정하면 승인이 풀렸다는 이력을 남긴다. */
export function reconfirmExpense(e: Expense, by: string, before: Expense | undefined, at: string = new Date().toISOString()): Expense {
  const next = confirmExpense(e, by);
  if (!before?.approvedBy || next.approvedBy) return next;
  return addLog(next, by, `승인된 기록을 고쳐 승인이 풀렸습니다 (이전 승인: ${before.approvedBy})`, at);
}

/** 승인자의 승인. 승인 대기 상태에서만 동작한다. */
export function approveExpense(e: Expense, by: string, at: string = new Date().toISOString()): Expense {
  if (deriveStatus(e) !== "pending_approval") return e;
  return addLog(withStatus({ ...e, approvedBy: by, approvedAt: at }), by, "승인했습니다", at);
}

export interface Actor {
  name: string;
  role: "submitter" | "approver";
  /** 단체 공간에 들어가 있는지. 혼자 쓰는 기기는 한 기기에서 등록과 승인을 함께 한다. */
  shared: boolean;
}
const sameName = (a: string, b: string) => a.trim() !== "" && a.trim() === b.trim();

/**
 * 이 사람이 이 기록을 승인할 수 없는 이유. 승인할 수 있으면 null.
 * 단체 공간에서는 승인자 역할만 승인하고, 자기가 올린 지출은 승인하지 못한다.
 */
export function approvalBlock(e: Expense, who: Actor): string | null {
  if (deriveStatus(e) !== "pending_approval") return "승인 대기 상태가 아닙니다";
  if (!who.shared) return null;
  if (who.role !== "approver") return "승인자가 승인합니다";
  if (sameName(e.submittedBy, who.name)) return "내가 올린 지출은 다른 승인자가 승인합니다";
  return null;
}

/** 금액은 같고 가맹점 이름만 조금 다른 경우를 잡으려고 공백과 기호를 뺀다. */
const norm = (s: string) => s.replace(/\(주\)|주식회사|㈜|[\s()\-·.,_/]/g, "").toLowerCase();

/** 같은 영수증일 수 있는 다른 기록: 날짜와 금액이 같고, 가맹점이 같거나 한쪽이 비어 있다. */
export function findDuplicates(e: Expense, list: Expense[]): Expense[] {
  if (!e.date || e.amount == null || !(e.amount > 0)) return [];
  const m = norm(e.merchant);
  return list.filter((x) => {
    if (x.id === e.id || x.date !== e.date || x.amount !== e.amount) return false;
    const o = norm(x.merchant);
    return !m || !o || m === o;
  });
}

/** 목록 안에서 서로 겹칠 수 있는 기록의 id. */
export function duplicateIds(list: Expense[]): Set<string> {
  const ids = new Set<string>();
  for (const e of list) if (findDuplicates(e, list).length) ids.add(e.id);
  return ids;
}

/** 검토 목록에 올릴 기록: 완료가 아닌 것 전부. */
export function needsAttention(list: Expense[]): Expense[] {
  return list.filter((e) => e.status === "needs_evidence" || e.status === "pending_approval" || e.status === "draft");
}
