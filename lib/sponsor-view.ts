// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 후원자용 보기 자료. 사업별 결산보고서와 영수증 목록(가린 사진만)을 담는다.
 * 원본 사진, 메모, 내부 확인 항목은 들어가지 않는다.
 */
import { evidenceLabel, sortByDate } from "./csv";
import type { LedgerSummary } from "./ledger";
import { buildReport, type Report } from "./report";
import { buildShare } from "./share";
import type { Expense } from "./types";

export interface ViewReceipt {
  id: string;
  date: string;
  item: string;
  amount: number;
  evidence: string;
  /** 가린 사진이 있는지 */
  hasImage: boolean;
}
export interface ViewProject {
  project: string;
  report: Report;
  receipts: ViewReceipt[];
  /** 이 사업 기록 전체의 지문. 기록이 하나라도 바뀌면 달라진다. */
  fingerprint?: string;
}
export interface ViewProof {
  ledger: LedgerSummary;
  /** 사업 이름 → 기록 지문 */
  prints: Record<string, string>;
}
export interface ViewBundle {
  v: 1;
  org: string;
  publishedAt: string;
  showNames: boolean;
  /** 후원자용 보기를 껐으면 true. 나머지는 비운다. */
  disabled?: boolean;
  projects: ViewProject[];
  /** 서명 원장의 지문과 규모 */
  ledger?: LedgerSummary;
}

// 자리표시가 아닌 진짜 가린 사진이 있는지 (길이로 구분).
const hasMasked = (e: Expense) => !!e.evidence.image && e.evidence.image.length > 200;

/** 후원자에게 보일 자료 묶음. 꺼져 있으면 "닫힘" 표시만 담는다. 이름 표시는 lib/share.ts의 가림 규칙을 그대로 쓴다. */
export function buildViewBundle(expenses: Expense[], org: string, opts: { enabled: boolean; showNames: boolean }, now = new Date().toISOString(), proof?: ViewProof): ViewBundle {
  if (!opts.enabled) return { v: 1, org, publishedAt: now, showNames: false, disabled: true, projects: [] };
  const names = [...new Set(expenses.map((e) => e.project).filter(Boolean))].sort();
  return {
    v: 1,
    org,
    publishedAt: now,
    showNames: opts.showNames,
    ledger: proof?.ledger,
    projects: names.map((project) => {
      const list = sortByDate(expenses.filter((e) => e.project === project));
      const shared = buildShare(buildReport(expenses, project, now), org, { includeRows: true, showNames: opts.showNames }, now);
      return {
        project,
        fingerprint: proof?.prints[project],
        report: shared.report,
        receipts: list.map((e) => ({ id: e.id, date: e.date, item: e.item, amount: e.amount ?? 0, evidence: evidenceLabel(e), hasImage: hasMasked(e) })),
      };
    }),
  };
}

/** 후원자용으로 올릴 가린 사진 (기록 id → 사진). */
export function viewImages(expenses: Expense[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of expenses) if (e.project && hasMasked(e)) m.set(e.id, e.evidence.image!);
  return m;
}
