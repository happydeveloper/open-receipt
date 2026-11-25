// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 앱 전체가 함께 쓰는 자료 형식.
 *
 * 중심은 Expense(지출 기록 한 건)다. 화면, 에이전트, 동기화, 서명 원장, 결산보고서가
 * 모두 이 형식을 주고받는다.
 *
 * - status는 저장되어 있지만 믿지 않는다. 읽을 때마다 lib/status.ts의 deriveStatus로 다시 계산한다.
 * - aiDrafted에는 AI가 채운 필드 이름이 들어 있다. 사람이 그 값을 고치면 이름이 빠진다(lib/flow.ts).
 * - confirmed, approvedBy는 사람이 버튼을 눌렀을 때만 바뀐다.
 */
export type PaymentMethod = "org_card" | "transfer" | "personal" | "cash";
export type Reimbursement = "needed" | "not_needed" | "unknown";
export type Status = "draft" | "needs_evidence" | "pending_approval" | "done";

/** 영수증과 함께 한 거래로 묶는 자료 한 장 (거래명세서, 주문내역, 이체확인증 …). */
export interface Attachment {
  id: string;
  /** 자료 종류 */
  label: string;
  /** 가린 이미지(data URI) */
  image?: string;
  /** 원본 사진이 따로 보관되어 있는지 */
  original?: boolean;
}
export interface Evidence {
  kind: "receipt" | "alternative" | "none";
  /** 가린 이미지(data URI). AI와 후원자에게는 이것만 보인다. */
  image?: string;
  /** 원본 사진이 따로 보관되어 있는지. 원본은 기기 저장소에 두고 단체 구성원에게만 암호화해 공유한다. */
  original?: boolean;
  altType?: string;
  reason?: string;
  /** 같은 거래의 다른 자료. 지출 건수와 금액은 늘지 않는다. */
  extra?: Attachment[];
}
export interface Source {
  title: string;
  url: string;
  hostname: string;
  date: string | null;
  description: string;
}
export interface ChecklistItem {
  text: string;
  sourceUrl: string;
}
export interface Guidance {
  query: string;
  sources: Source[];
  checklist: ChecklistItem[];
  searchedAt: string;
}
export interface OpenItem {
  code: "evidence" | "fields" | "reimbursement" | "approval";
  text: string;
}
/** 승인과 관련된 변경 이력 한 줄. */
export interface LogEntry {
  at: string;
  by: string;
  text: string;
}
export interface Expense {
  id: string;
  date: string;
  item: string;
  amount: number | null;
  merchant: string;
  purpose: string;
  project: string;
  budgetCategory: string;
  paymentMethod: PaymentMethod | null;
  payer: string;
  reimbursement: Reimbursement;
  evidence: Evidence;
  summary: string;
  /** 입력자가 내용을 확정했는지. AI 호출로는 절대 바뀌지 않는다. */
  confirmed: boolean;
  status: Status;
  guidance?: Guidance;
  aiDrafted: string[];
  submittedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  /** 마지막으로 바뀐 시각. 기기 간 동기화에서 더 새로운 쪽을 고르는 데 쓴다. */
  updatedAt?: string;
  /** 승인, 승인 뒤 수정 같은 변경 이력 */
  log?: LogEntry[];
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  org_card: "조직카드",
  transfer: "계좌이체",
  personal: "개인 선결제",
  cash: "현금",
};
export const STATUS_LABEL: Record<Status, string> = {
  draft: "초안",
  needs_evidence: "증빙 보완",
  pending_approval: "승인 대기",
  done: "완료",
};
export const REIMB_LABEL: Record<Reimbursement, string> = {
  needed: "환급 필요",
  not_needed: "환급 불필요",
  unknown: "미확인",
};
