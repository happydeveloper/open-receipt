// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 사업별 결산보고서. 기록 목록에서 보고서 자료(Report)를 만들고, 내려받기용 HTML로 바꾼다.
 *
 * 같은 Report를 앱의 결산보고서 화면, 공유 링크(lib/share.ts), 후원자용 보기(lib/sponsor-view.ts)가 함께 쓴다.
 * 보고서는 판정을 담지 않는다. 합계와 분류, 그리고 사람이 "확인할 항목"만 담는다.
 */
import { evidenceLabel, sortByDate, totalAmount } from "./csv";
import { openItems } from "./status";
import { PAYMENT_LABEL, STATUS_LABEL, type Expense, type Status } from "./types";

export interface ReportRow {
  date: string;
  item: string;
  amount: number;
  budgetCategory: string;
  payment: string;
  evidence: string;
  status: string;
  summary: string;
}
export interface Report {
  project: string;
  period: string;
  generatedAt: string;
  count: number;
  total: number;
  approvedTotal: number;
  byCategory: { name: string; count: number; amount: number }[];
  byPayment: { name: string; count: number; amount: number }[];
  byStatus: { name: string; count: number; amount: number }[];
  rows: ReportRow[];
  openItems: { item: string; amount: number; text: string }[];
  reimbursements: { payer: string; item: string; amount: number; approved: boolean }[];
  reimbursementTotal: number;
  sources: { title: string; url: string; date: string | null; searchedAt: string }[];
}

/** 이름별 건수와 금액. 금액이 큰 순서로 돌려준다. */
function group(list: Expense[], key: (e: Expense) => string) {
  const m = new Map<string, { name: string; count: number; amount: number }>();
  for (const e of list) {
    const name = key(e) || "미분류";
    const g = m.get(name) ?? { name, count: 0, amount: 0 };
    g.count++;
    g.amount += e.amount ?? 0;
    m.set(name, g);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}

/** 지출 기간 문구: 가장 이른 날짜 ~ 가장 늦은 날짜. */
export function periodOf(list: Expense[]): string {
  const dates = list.map((e) => e.date).filter(Boolean).sort();
  if (!dates.length) return "-";
  const a = dates[0], b = dates[dates.length - 1];
  return a === b ? a : `${a} ~ ${b}`;
}

/** 사업별 결산보고서 초안 데이터. 판정 없이 합계와 "확인할 항목"만 담는다. */
export function buildReport(all: Expense[], project: string, generatedAt = new Date().toISOString()): Report {
  const list = sortByDate(all.filter((e) => e.project === project));
  const order: Status[] = ["done", "pending_approval", "needs_evidence", "draft"];
  const byStatus = group(list, (e) => STATUS_LABEL[e.status]).sort(
    (a, b) => order.findIndex((s) => STATUS_LABEL[s] === a.name) - order.findIndex((s) => STATUS_LABEL[s] === b.name),
  );
  const reimb = list.filter((e) => e.paymentMethod === "personal" && e.reimbursement === "needed");
  const seen = new Set<string>();
  const sources: Report["sources"] = [];
  for (const e of list) {
    // 검색된 출처 가운데 "확인할 자료" 항목에 실제로 연결된 것만 보고서에 싣는다.
    for (const s of e.guidance?.sources ?? []) {
      const used = e.guidance!.checklist.some((c) => c.sourceUrl === s.url);
      if (!used || seen.has(s.url)) continue;
      seen.add(s.url);
      sources.push({ title: s.title, url: s.url, date: s.date, searchedAt: e.guidance!.searchedAt });
    }
  }
  return {
    project,
    period: periodOf(list),
    generatedAt,
    count: list.length,
    total: totalAmount(list),
    approvedTotal: totalAmount(list.filter((e) => e.status === "done")),
    byCategory: group(list, (e) => e.budgetCategory),
    byPayment: group(list, (e) => (e.paymentMethod ? PAYMENT_LABEL[e.paymentMethod] : "")),
    byStatus,
    rows: list.map((e) => ({
      date: e.date,
      item: e.item,
      amount: e.amount ?? 0,
      budgetCategory: e.budgetCategory || "미분류",
      payment: e.paymentMethod ? PAYMENT_LABEL[e.paymentMethod] : "",
      evidence: evidenceLabel(e),
      status: STATUS_LABEL[e.status],
      summary: e.summary,
    })),
    openItems: list.flatMap((e) => openItems(e).map((o) => ({ item: e.item, amount: e.amount ?? 0, text: o.text }))),
    reimbursements: reimb.map((e) => ({ payer: e.payer, item: e.item, amount: e.amount ?? 0, approved: e.status === "done" })),
    reimbursementTotal: totalAmount(reimb),
    sources,
  };
}

export const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** 내려받기용 단독 HTML 문서. */
export function reportToHtml(r: Report): string {
  const table = (head: string[], rows: (string | number)[][], numCols: number[] = []) =>
    `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
      .map((row) => `<tr>${row.map((c, i) => `<td${numCols.includes(i) ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(r.project)} 결산보고서 초안</title>
<style>body{font-family:"Apple SD Gothic Neo","Malgun Gothic",sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1c2430;line-height:1.6}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:2px solid #1c2430;padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #b9c2cf;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#eef1f5}.n{text-align:right;white-space:nowrap}.meta{color:#5d6878;font-size:13px}.sign{display:flex;gap:24px;margin-top:32px}
.sign div{flex:1;border-top:1px solid #1c2430;padding-top:6px;font-size:13px}.note{font-size:12px;color:#5d6878;margin-top:24px}</style></head><body>
<h1>${esc(r.project)} 결산보고서 초안</h1>
<p class="meta">지출 기간 ${esc(r.period)} · 작성 ${esc(r.generatedAt.slice(0, 10))} · 열린영수증</p>
<h2>1. 요약</h2>
${table(["지출 건수", "지출 합계", "승인 완료 금액", "확인할 항목", "환급 필요 금액"], [[`${r.count}건`, won(r.total), won(r.approvedTotal), `${r.openItems.length}건`, won(r.reimbursementTotal)]], [0, 1, 2, 3, 4])}
<h2>2. 예산 항목별 집행</h2>
${table(["예산 항목", "건수", "금액"], [...r.byCategory.map((g) => [g.name, `${g.count}건`, won(g.amount)]), ["합계", `${r.count}건`, won(r.total)]], [1, 2])}
<h2>3. 결제 방식별 집행</h2>
${table(["결제 방식", "건수", "금액"], r.byPayment.map((g) => [g.name, `${g.count}건`, won(g.amount)]), [1, 2])}
<h2>4. 지출 내역</h2>
${table(["날짜", "항목", "금액", "예산 항목", "결제", "증빙", "상태", "내용"], r.rows.map((x) => [x.date, x.item, won(x.amount), x.budgetCategory, x.payment, x.evidence, x.status, x.summary]), [2])}
<h2>5. 제출 전 확인할 항목</h2>
${r.openItems.length ? table(["항목", "금액", "다음 행동"], r.openItems.map((o) => [o.item, won(o.amount), o.text]), [1]) : "<p>확인할 항목이 없습니다.</p>"}
<h2>6. 환급 대상</h2>
${r.reimbursements.length ? table(["결제자", "항목", "금액", "승인"], r.reimbursements.map((x) => [x.payer, x.item, won(x.amount), x.approved ? "승인 완료" : "승인 전"]), [2]) : "<p>환급 대상이 없습니다.</p>"}
<h2>7. 참고한 공개 지침</h2>
${r.sources.length ? `<ul>${r.sources.map((s) => `<li><a href="${esc(s.url)}">${esc(s.title)}</a> (${esc(s.date ?? "날짜 미상")}, 검색 ${esc(s.searchedAt.slice(0, 10))})</li>`).join("")}</ul>` : "<p>연결된 출처가 없습니다.</p>"}
<div class="sign"><div>작성자 (총무·재정 담당)</div><div>확인자 (대표·승인자)</div></div>
<p class="note">이 문서는 초안입니다. AI가 도운 내용이 포함되어 있으며, 지출의 적정성 판단과 최종 승인·제출은 조직의 담당자가 합니다. 시연 데이터는 모두 가상입니다.</p>
</body></html>`;
}
