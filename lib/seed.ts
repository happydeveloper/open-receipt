// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 데모 데이터. 인물, 단체, 거래가 모두 가상이다.
 * "데모 데이터 불러오기"와 테스트가 이 값에서 시작한다.
 */
import { newExpense } from "./status";
import type { Expense } from "./types";

export const DEMO_PROJECT = "자원봉사자 워크숍";
export const DEMO_PERIOD = "2026년 11월";
export const SUBMITTER = "김○○";
export const APPROVER = "박○○";
/** 1x1 회색 점. 시드 데이터에서 "가린 영수증 이미지가 첨부됨"을 나타내는 자리표시자. */
export const PLACEHOLDER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==";

/** 모두 가상 데이터. 시연은 이 2건에서 시작해 "행사 다과"를 직접 입력한다. */
export function seedExpenses(): Expense[] {
  return [
    newExpense({
      id: "seed-print",
      date: "2026-11-18",
      item: "인쇄물",
      amount: 18000,
      merchant: "○○인쇄",
      purpose: "워크숍 자료집 인쇄",
      project: DEMO_PROJECT,
      budgetCategory: "홍보·인쇄비",
      paymentMethod: "org_card",
      payer: "단체 카드",
      reimbursement: "not_needed",
      evidence: { kind: "receipt", image: PLACEHOLDER_IMAGE },
      summary: "자원봉사자 워크숍 자료집 인쇄. 조직카드 결제.",
      confirmed: true,
      submittedBy: SUBMITTER,
      approvedBy: APPROVER,
      approvedAt: "2026-11-18T09:00:00.000Z",
    }),
    newExpense({
      id: "seed-transport",
      date: "2026-11-19",
      item: "교통비",
      amount: 12500,
      merchant: "",
      purpose: "강사 교통비 지급",
      project: DEMO_PROJECT,
      budgetCategory: "여비·교통비",
      paymentMethod: "transfer",
      payer: "단체 계좌",
      reimbursement: "not_needed",
      evidence: { kind: "none" },
      summary: "자원봉사자 워크숍 강사 교통비. 계좌이체.",
      confirmed: true,
      submittedBy: SUBMITTER,
    }),
  ];
}

/** 시연에서 직접 입력하게 되는 거래의 완성본 (테스트·리허설 기준값). */
export function demoSnackExpense(): Expense {
  return newExpense({
    id: "demo-snack",
    date: "2026-11-18",
    item: "행사 다과",
    amount: 26400,
    merchant: "○○마트",
    purpose: "워크숍 다과 구매",
    project: DEMO_PROJECT,
    budgetCategory: "회의·행사비",
    paymentMethod: "personal",
    payer: SUBMITTER,
    reimbursement: "needed",
    evidence: { kind: "receipt", image: PLACEHOLDER_IMAGE },
    summary: "자원봉사자 워크숍 다과 구매. 김○○ 개인 카드 선결제, 환급 요청.",
    confirmed: true,
    submittedBy: SUBMITTER,
  });
}
