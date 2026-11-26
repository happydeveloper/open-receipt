// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 두 기기가 같은 기록을 고쳤을 때: 서로 다른 칸이면 둘 다 남고, 같은 칸이면 나중 것이 남는다.
 * 승인한 뒤 다른 기기에서 내용이 바뀌었으면 승인이 풀린다.
 */
import { describe, expect, it } from "vitest";
import { describeChanges, logEdits } from "@/lib/history";
import { recordDigest } from "@/lib/ledger";
import { demoSnackExpense } from "@/lib/seed";
import { normalizeField, normalizeRecord } from "@/lib/agent";
import { normalizeAmount } from "@/lib/draft";
import { buildReport, reportToHtml, spendRate, won } from "@/lib/report";
import { filterExpenses, isFiltering, NO_FILTER, type ListFilter } from "@/lib/search";
import { EMPTY_SETTINGS, normalizeBudgets, normalizeSettings, setBudget } from "@/lib/settings";
import { approvalBlock, approveExpense, confirmExpense, findDuplicates, missingFields, newExpense, openItems, returnExpense } from "@/lib/status";
import { syncNow, type SyncApi, type SyncLocal } from "@/lib/sync-client";
import { decryptText, newWorkspace, viewerWorkspace } from "@/lib/sync-crypto";
import { clampFuture, mergeExpenses, mergeRecord, touchChanged } from "@/lib/sync-merge";
import { clearViewImages, delImage, getDoc, getImage, getView, MemoryStore, purgeRecordImages, putDoc, putImage, putView, type SyncStore } from "@/lib/sync-store";
import type { Expense } from "@/lib/types";

const T = (n: number) => `2026-11-2${n}T10:00:00.000Z`;
const base = (): Expense => ({ ...demoSnackExpense(), updatedAt: T(0) });
/** 한 기기에서 기록을 고친 것처럼 시각을 찍는다. */
const edit = (e: Expense, patch: Partial<Expense>, at: string) => touchChanged([e], [{ ...e, ...patch }], at)[0];
const shared = { org: "다온 나눔모임", projects: ["자원봉사자 워크숍"], funder: "", approver: "박대표" };
function api(store: SyncStore): SyncApi {
  const out = async (r: Response) => ({ status: r.status, body: await r.json() });
  return {
    getDoc: async (id, since) => out(await getDoc(store, id, since)), putDoc: async (id, t, b) => out(await putDoc(store, id, t, b)),
    getImage: async (id, e, k) => out(await getImage(store, id, e, k)), putImage: async (id, e, t, b, k) => out(await putImage(store, id, e, t, b, k)),
    delImage: async (id, e, t, k) => out(await delImage(store, id, e, t, k)), purgeRecord: async (id, e, t) => out(await purgeRecordImages(store, id, e, t)),
    getView: async (id) => out(await getView(store, id)), putView: async (id, t, b) => out(await putView(store, id, t, b)), clearView: async (id, t) => out(await clearViewImages(store, id, t)),
  };
}
const device = (expenses: Expense[], over: Partial<SyncLocal> = {}): SyncLocal => ({ expenses, tombstones: {}, shared, sharedAt: T(0), uploaded: [], ...over });

describe("칸 단위로 합치기", () => {
  it("고친 칸마다 시각이 찍힌다. 새로 만든 기록과 그대로인 기록에는 찍히지 않는다", () => {
    const a = base();
    const [same, changed, added] = touchChanged([a, { ...a, id: "b" }], [a, { ...a, id: "b", purpose: "새 목적", amount: 1 }, { ...a, id: "c" }], T(1));
    expect(same).toBe(a);
    expect(changed.fieldAt).toEqual({ purpose: T(1), amount: T(1) });
    expect(changed.updatedAt).toBe(T(1));
    expect(added.fieldAt).toBeUndefined();
    // 승인은 한 칸으로 적는다
    const pending = confirmExpense(a, "김총무");
    const approved = touchChanged([pending], [approveExpense(pending, "박대표", T(2))], T(2))[0];
    expect(approved.fieldAt).toEqual({ approvedBy: T(2) });
  });

  it("총무가 목적을, 승인자가 예산 항목을 고치면 둘 다 남는다 (어느 쪽에서 합쳐도 같다)", () => {
    const mine = edit(base(), { purpose: "총무가 고친 목적" }, T(1));
    const theirs = edit(base(), { budgetCategory: "승인자가 고친 예산 항목" }, T(2));
    for (const [l, r] of [[mine, theirs], [theirs, mine]]) {
      const out = mergeExpenses([l], [r], {}, {});
      expect(out.expenses[0]).toMatchObject({ purpose: "총무가 고친 목적", budgetCategory: "승인자가 고친 예산 항목", updatedAt: T(2) });
      expect(out.expenses[0].fieldAt).toEqual({ purpose: T(1), budgetCategory: T(2) });
      expect(out.merged).toEqual(["demo-snack"]);
    }
  });

  it("같은 칸을 둘 다 고쳤으면 나중에 고친 쪽이 남고, 다른 칸의 수정은 그대로 산다", () => {
    const mine = edit(edit(base(), { amount: 27000 }, T(1)), { purpose: "먼저 고친 목적" }, T(1));
    const theirs = edit(base(), { amount: 28000 }, T(2));
    const out = mergeExpenses([mine], [theirs], {}, {}).expenses[0];
    expect(out.amount).toBe(28000);
    expect(out.purpose).toBe("먼저 고친 목적");
  });

  it("한쪽만 고쳤으면 예전과 같다: 고친 쪽이 남고, 섞였다고 세지 않는다", () => {
    const edited = edit(base(), { amount: 13000 }, T(1));
    const out = mergeExpenses([base()], [edited], {}, {});
    expect(out.expenses[0].amount).toBe(13000);
    expect(out.merged).toEqual([]);
    // 칸별 시각이 없는 예전 기록끼리는 더 최근에 바뀐 사본을 통째로 고른다
    const old = mergeExpenses([{ ...base(), amount: 1, updatedAt: T(1) }], [{ ...base(), purpose: "x", updatedAt: T(2) }], {}, {});
    expect(old.expenses[0]).toMatchObject({ amount: 26400, purpose: "x" });
  });

  it("AI가 채웠다는 표시는 값을 가져온 쪽을 따르고, 이력은 양쪽 것이 모두 남는다", () => {
    const a = { ...base(), aiDrafted: ["purpose", "item"], log: [{ at: T(0), by: "김총무", text: "처음 올림" }] };
    const mine = edit(a, { purpose: "사람이 고친 목적", aiDrafted: ["item"], log: [...a.log, { at: T(1), by: "김총무", text: "목적 수정" }] }, T(1));
    const theirs = edit(a, { budgetCategory: "행사비", log: [...a.log, { at: T(2), by: "박대표", text: "예산 항목 수정" }] }, T(2));
    const out = mergeRecord(theirs, mine).expense;
    expect(out.aiDrafted).toEqual(["item"]);
    expect(out.log!.map((l) => l.text)).toEqual(["처음 올림", "목적 수정", "예산 항목 수정"]);
  });

  it("승인자가 승인하는 사이 총무가 내용을 고쳤으면, 고친 내용은 남고 승인은 풀린다", () => {
    const pending = { ...confirmExpense(base(), "김총무"), updatedAt: T(0) };
    const approved = touchChanged([pending], [approveExpense(pending, "박대표", T(2))], T(2))[0];
    const edited = edit(pending, { amount: 99000 }, T(1));
    for (const [l, r] of [[approved, edited], [edited, approved]]) {
      const out = mergeExpenses([l], [r], {}, {}).expenses[0];
      expect(out.amount).toBe(99000);
      expect(out.approvedBy).toBeUndefined();
      expect(out.status).toBe("pending_approval");
      expect(out.log!.at(-1)!.text).toContain("다른 기기에서 내용이 바뀌어 승인이 풀렸습니다");
    }
    // 내용이 그대로면(메모가 아닌 승인만 얹힌 경우) 승인은 유지된다
    const kept = mergeExpenses([approved], [pending], {}, {}).expenses[0];
    expect(kept.approvedBy).toBe("박대표");
  });

  it("칸별 시각은 서명할 내용에 들어가지 않는다", async () => {
    const a = base();
    expect(await recordDigest(edit(a, { purpose: a.purpose + " " }, T(1)))).not.toBe(await recordDigest(a));
    expect(await recordDigest({ ...a, fieldAt: { purpose: T(1) } })).toBe(await recordDigest(a));
  });

  it("단체 공간 왕복: 두 기기가 각자 고친 뒤 차례로 동기화하면 세 기기 모두 같은 결과를 본다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const a0 = await syncNow(ws, device([base()]), api(store), T(0));
    const b0 = await syncNow(ws, device([]), api(store), T(0));
    // 둘 다 연결이 끊긴 채 고친다
    const mine = edit(a0.expenses[0], { purpose: "총무가 고친 목적" }, T(1));
    const theirs = edit(b0.expenses[0], { budgetCategory: "승인자가 고친 예산 항목" }, T(2));
    const b1 = await syncNow(ws, { ...b0, expenses: [theirs] }, api(store), T(3));
    expect(b1.mergedIds).toEqual([]);
    const a1 = await syncNow(ws, { ...a0, expenses: [mine] }, api(store), T(4));
    expect(a1.mergedIds).toEqual(["demo-snack"]);
    expect(a1.expenses[0]).toMatchObject({ purpose: "총무가 고친 목적", budgetCategory: "승인자가 고친 예산 항목" });
    const b2 = await syncNow(ws, b1, api(store), T(5));
    const c = await syncNow(ws, device([]), api(store), T(6));
    for (const d of [b2, c]) expect(d.expenses[0]).toMatchObject({ purpose: "총무가 고친 목적", budgetCategory: "승인자가 고친 예산 항목" });
    // 다시 동기화해도 더 바뀌지 않는다
    expect((await syncNow(ws, a1, api(store), T(7))).changed).toBe(false);
  });
});

describe("고친 내용을 이력에 남기기", () => {
  it("확정된 기록을 고치면 무엇이 무엇으로 바뀌었는지 한 줄로 남는다. 초안과 그대로인 기록에는 남기지 않는다", () => {
    const confirmed = { ...confirmExpense(base(), "김총무"), updatedAt: T(0) };
    const draft = { ...base(), id: "draft", confirmed: false };
    const [a, b, c] = logEdits([confirmed, draft, { ...confirmed, id: "same" }], [{ ...confirmed, amount: 27000, purpose: "간식과 음료", paymentMethod: "org_card" as const }, { ...draft, amount: 1 }, { ...confirmed, id: "same" }], "김총무", T(1));
    expect(a.log!.at(-1)).toEqual({ at: T(1), by: "김총무", text: "고쳤습니다. 금액: 26,400원 → 27,000원, 목적: 워크숍 다과 구매 → 간식과 음료, 결제 방식: 개인 선결제 → 조직카드" });
    expect(b.log).toBeUndefined();
    expect(c.log).toBeUndefined();
    expect(describeChanges(confirmed, { ...confirmed, summary: "요약만 바뀜", aiDrafted: [] })).toEqual([]);
  });

  it("두 기기가 같은 칸을 고쳐 한쪽이 덮이면, 남은 값과 덮인 값을 이력에 적는다 (어느 쪽에서 합쳐도 같은 문장)", () => {
    const start = { ...confirmExpense(base(), "김총무"), updatedAt: T(0) };
    const mine = touchChanged([start], logEdits([start], [{ ...start, amount: 13000 }], "김총무", T(1)), T(1))[0];
    const theirs = touchChanged([start], logEdits([start], [{ ...start, amount: 14000 }], "박승인", T(2)), T(2))[0];
    const texts = [[mine, theirs], [theirs, mine]].map(([l, r]) => mergeExpenses([l], [r], {}, {}).expenses[0]).map((e) => { expect(e.amount).toBe(14000); return e.log!.map((l) => `${l.by}: ${l.text}`); });
    expect(texts[0]).toEqual(texts[1]);
    expect(texts[0]).toEqual([
      "김총무: 고쳤습니다. 금액: 26,400원 → 13,000원",
      "박승인: 고쳤습니다. 금액: 26,400원 → 14,000원",
      "동기화: 금액: 두 기기에서 함께 고쳐 나중에 고친 값(14,000원)을 남겼습니다. 덮인 값: 13,000원",
    ]);
    // 다시 합쳐도 같은 줄이 또 생기지 않는다
    const once = mergeExpenses([mine], [theirs], {}, {}).expenses[0];
    expect(mergeExpenses([once], [mine], {}, {}).expenses[0].log).toHaveLength(3);
  });
});

describe("시계가 틀린 기기", () => {
  const DAY = 24 * 60 * 60_000;
  it("서버 시각보다 한참 뒤로 찍힌 시각은 서버 시각으로 되돌린다. 제대로 찍힌 시각은 건드리지 않는다", () => {
    const now = "2026-11-20T10:30:00.000Z";
    const ok = edit(base(), { purpose: "x" }, T(0));
    const future = edit(base(), { amount: 1 }, new Date(Date.parse(now) + DAY).toISOString());
    const [a, b] = clampFuture([ok, future], now);
    expect(a).toBe(ok);
    expect(b.updatedAt).toBe(now);
    expect(b.fieldAt).toEqual({ amount: now });
    expect(clampFuture([future], "")).toEqual([future]); // 서버 시각을 모르면 그대로 둔다
  });

  it("시계가 하루 빠른 기기가 먼저 고친 값이, 다른 기기가 나중에 고친 값을 더는 이기지 못한다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const real = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const start = { ...base(), updatedAt: iso(real - 60 * 60_000) };
    const a0 = await syncNow(ws, device([start]), api(store), iso(real));
    const b0 = await syncNow(ws, device([]), api(store), iso(real));
    // 시계가 하루 빠른 기기 A가 금액을 고쳐 올린다 → 서버 시각으로 끌어내려진다
    const fast = touchChanged([a0.expenses[0]], [{ ...a0.expenses[0], amount: 11111 }], iso(real + DAY))[0];
    const a1 = await syncNow(ws, { ...a0, expenses: [fast] }, api(store), iso(real));
    expect(Date.parse(a1.expenses[0].fieldAt!.amount)).toBeLessThan(real + 5 * 60_000);
    // 그 뒤 기기 B가 고치면 B의 값이 남는다 (예전에는 A의 11,111원이 계속 이겼다)
    const b1 = await syncNow(ws, b0, api(store), iso(real));
    const later = touchChanged([b1.expenses[0]], [{ ...b1.expenses[0], amount: 22222 }], iso(Date.now() + 1000))[0];
    const b2 = await syncNow(ws, { ...b1, expenses: [later] }, api(store), iso(real));
    expect(b2.expenses[0].amount).toBe(22222);
    expect((await syncNow(ws, a1, api(store), iso(real))).expenses[0].amount).toBe(22222);
  });

  it("서버 시계와 30초 넘게 다르면 그 차이를 돌려준다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const near = await syncNow(ws, device([base()]), api(store));
    expect(near.clockOffset).toBe(0);
    // 서버가 10분 앞서 있는 것처럼 답한다 = 이 기기 시계가 10분 느리다
    const ahead: SyncApi = { ...api(store), getDoc: async (id, since) => { const r = await api(store).getDoc(id, since); return { ...r, body: { ...r.body, now: new Date(Date.now() + 10 * 60_000).toISOString() } }; } };
    const slow = await syncNow(ws, near, ahead);
    expect(Math.round(slow.clockOffset / 60_000)).toBe(10);
  });
});

describe("환불 기록", () => {
  it("음수 금액은 환불로 받아들이고, 0과 빈 값만 빠진 것으로 본다", () => {
    const refund = newExpense({ date: "2026-11-21", item: "다과 반품", project: "자원봉사자 워크숍", paymentMethod: "org_card", amount: -5000, evidence: { kind: "alternative", altType: "거래명세서", reason: "반품 환불" } });
    expect(missingFields(refund)).toEqual([]);
    expect(missingFields({ ...refund, amount: 0 })).toEqual(["금액"]);
    expect(missingFields({ ...refund, amount: null })).toEqual(["금액"]);
    expect(confirmExpense(refund, "김총무").status).toBe("pending_approval");
  });

  it("환불은 합계에서 빠지고, 결산보고서에 음수로 나온다", () => {
    const spent = { ...base(), confirmed: true };
    const refund = newExpense({ id: "refund", date: "2026-11-21", item: "다과 반품", project: spent.project, budgetCategory: spent.budgetCategory, paymentMethod: "org_card", amount: -5000, evidence: { kind: "alternative", altType: "거래명세서", reason: "반품 환불" } });
    const r = buildReport([spent, refund], spent.project);
    expect(r.count).toBe(2);
    expect(r.total).toBe(26400 - 5000);
    expect(r.rows.find((x) => x.item === "다과 반품")!.amount).toBe(-5000);
    expect(won(-5000)).toBe("-5,000원");
  });

  it("사람이 넣은 환불은 에이전트로 오가도 그대로이고, 모델이 준 음수는 받지 않는다", () => {
    expect(normalizeAmount(-5000, true)).toBe(-5000);
    expect(normalizeAmount("-5,000원", true)).toBe(-5000);
    expect(normalizeAmount(0, true)).toBeNull();
    expect(normalizeAmount(-5000)).toBeNull();
    expect(normalizeRecord({ amount: -5000, item: "반품" })).toEqual({ amount: -5000, item: "반품" });
    expect(normalizeField("amount", -5000)).toBeUndefined();
  });

  it("같은 날 같은 금액의 환불끼리는 중복으로 알리고, 지출과 환불은 서로 중복이 아니다", () => {
    const a = newExpense({ id: "a", date: "2026-11-21", amount: -5000 });
    const b = newExpense({ id: "b", date: "2026-11-21", amount: -5000 });
    const c = newExpense({ id: "c", date: "2026-11-21", amount: 5000 });
    expect(findDuplicates(a, [a, b, c]).map((x) => x.id)).toEqual(["b"]);
  });
});

describe("목록에서 찾기", () => {
  const list = [
    newExpense({ id: "a", date: "2026-11-18", item: "행사 다과", merchant: "○○마트 워크숍점", amount: 26400, payer: "김○○", confirmed: true, project: "p", paymentMethod: "personal", evidence: { kind: "receipt", image: "x", extra: [{ id: "s", label: "거래명세서" }] } }),
    newExpense({ id: "b", date: "2026-11-18", item: "인쇄물", merchant: "가상인쇄", amount: 18000, budgetCategory: "홍보·인쇄비" }),
    newExpense({ id: "c", date: "2026-11-21", item: "다과 반품", amount: -5000 }),
  ];
  const ids = (f: Partial<ListFilter>) => filterExpenses(list, { ...NO_FILTER, ...f }).map((e) => e.id);
  it("항목, 가게, 사람, 예산 항목, 날짜, 붙인 자료 이름으로 찾는다. 여러 낱말은 모두 들어 있어야 한다", () => {
    expect(ids({ q: "다과" })).toEqual(["a", "c"]);
    expect(ids({ q: "마트" })).toEqual(["a"]);
    expect(ids({ q: "김○○" })).toEqual(["a"]);
    expect(ids({ q: "인쇄비" })).toEqual(["b"]);
    expect(ids({ q: "2026-11-21" })).toEqual(["c"]);
    expect(ids({ q: "거래명세서" })).toEqual(["a"]);
    expect(ids({ q: "다과 반품" })).toEqual(["c"]);
    expect(ids({ q: "  " })).toEqual(["a", "b", "c"]);
    expect(ids({ q: "없는말" })).toEqual([]);
  });
  it("금액은 쉼표와 원을 붙여도 찾고, 환불은 '환불'로 찾는다", () => {
    expect(ids({ q: "26,400원" })).toEqual(["a"]);
    expect(ids({ q: "18000" })).toEqual(["b"]);
    expect(ids({ q: "환불" })).toEqual(["c"]);
    expect(ids({ q: "5000" })).toEqual(["c"]);
  });
  it("상태로 거르고, 찾는 말과 함께 쓸 수 있다", () => {
    expect(ids({ status: "pending_approval" })).toEqual(["a"]);
    expect(ids({ status: "needs_evidence" })).toEqual(["b", "c"]);
    expect(ids({ status: "needs_evidence", q: "다과" })).toEqual(["c"]);
    expect(isFiltering(NO_FILTER)).toBe(false);
    expect(isFiltering({ q: "", status: "draft" })).toBe(true);
  });
});

describe("예산 대비 집행", () => {
  it("예산을 정하면 항목마다 예산, 집행률, 남은 금액이 나온다. 쓴 돈이 없는 항목도 보인다", () => {
    const a = { ...base(), budgetCategory: "회의·행사비", amount: 26400 };
    const b = { ...base(), id: "b", budgetCategory: "홍보·인쇄비", amount: 18000 };
    const r = buildReport([a, b], a.project, undefined, { "회의·행사비": 100000, "여비·교통비": 50000 });
    expect(r.budgetTotal).toBe(150000);
    expect(r.byCategory).toEqual([
      { name: "회의·행사비", count: 1, amount: 26400, budget: 100000 },
      { name: "홍보·인쇄비", count: 1, amount: 18000 },
      { name: "여비·교통비", count: 0, amount: 0, budget: 50000 },
    ]);
    expect(spendRate(26400, 100000)).toBe("26%");
    expect(spendRate(120000, 100000)).toBe("120%"); // 넘어도 판정하지 않고 숫자만 보인다
    expect(spendRate(18000)).toBe("");
    const html = reportToHtml(r);
    for (const t of ["집행률", "남은 금액", "100,000원", "26%", "73,600원"]) expect(html).toContain(t);
    // 예산을 정하지 않으면 예전 표 그대로다
    const plain = buildReport([a, b], a.project);
    expect(plain.budgetTotal).toBe(0);
    expect(reportToHtml(plain)).not.toContain("집행률");
  });
  it("예산 값은 다듬어 저장한다: 0 이하와 숫자가 아닌 값은 버리고, 0을 넣으면 그 항목을 지운다", () => {
    expect(normalizeBudgets({ p: { a: 1000.4, b: 0, c: -5, d: "글자", "": 9 }, q: "엉뚱", r: {} })).toEqual({ p: { a: 1000 } });
    expect(normalizeBudgets(null)).toEqual({});
    let s = setBudget(EMPTY_SETTINGS, "워크숍", "회의·행사비", 200000);
    s = setBudget(s, "워크숍", "홍보·인쇄비", 50000);
    expect(s.budgets).toEqual({ 워크숍: { "회의·행사비": 200000, "홍보·인쇄비": 50000 } });
    expect(setBudget(setBudget(s, "워크숍", "회의·행사비", null), "워크숍", "홍보·인쇄비", 0).budgets).toEqual({});
    expect(normalizeSettings({ budgets: { p: { a: 5 } } }).budgets).toEqual({ p: { a: 5 } });
  });
  it("예산은 단체 공간으로 다른 기기에 전해지고, 후원자용 보기의 보고서에도 실린다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const budgets = { [base().project]: { [base().budgetCategory]: 100000 } };
    await syncNow(ws, device([base()], { shared: { ...shared, sponsorView: true, budgets } }), api(store));
    const b = await syncNow(ws, device([], { shared: { org: "", projects: [], funder: "", approver: "" }, sharedAt: "" }), api(store));
    expect(b.shared.budgets).toEqual(budgets);
    const viewer = await viewerWorkspace(ws);
    const bundle = JSON.parse((await decryptText(viewer, (await (await getView(store, ws.id)).json()).data))!);
    expect(bundle.projects[0].report.budgetTotal).toBe(100000);
    expect(bundle.projects[0].report.byCategory[0].budget).toBe(100000);
  });
});

const NO_NEWS = { added: 0, addedBy: [], approved: 0, approvedBy: [], returned: 0, returnedBy: [] };
describe("등록자도 승인, 그리고 들어온 소식", () => {
  const pending = (by: string): Expense => ({ ...confirmExpense({ ...base(), confirmed: false }, by), updatedAt: T(0) });
  it("기본은 승인자만, 자기가 올린 것은 못 한다. 단체가 '등록자도 승인'으로 정하면 누구나 승인한다", () => {
    const e = pending("이회원");
    const member = { name: "최회원", role: "submitter" as const, shared: true };
    const approver = { name: "박대표", role: "approver" as const, shared: true };
    expect(approvalBlock(e, member)).toBe("승인자가 승인합니다");
    expect(approvalBlock(e, approver)).toBeNull();
    expect(approvalBlock(pending("박대표"), approver)).toBe("내가 올린 지출은 다른 승인자가 승인합니다");
    const open = { submitterApproves: true };
    expect(approvalBlock(e, member, open)).toBeNull();
    expect(approvalBlock(e, { ...member, name: "이회원" }, open)).toBeNull();
    expect(approvalBlock(pending("박대표"), approver, open)).toBeNull();
    // 승인 대기가 아니면 어떤 방식에서도 승인하지 못한다
    expect(approvalBlock({ ...e, confirmed: false }, member, open)).toBe("승인 대기 상태가 아닙니다");
    // 혼자 쓰는 기기는 예전처럼 바로 승인한다
    expect(approvalBlock(e, { name: "김총무", role: "submitter", shared: false })).toBeNull();
  });
  it("직접 올린 지출을 승인하면 이력에 그렇게 남는다", () => {
    expect(approveExpense(pending("김총무"), "김총무", T(1)).log!.at(-1)!.text).toBe("승인했습니다 (직접 올린 지출)");
    expect(approveExpense(pending("이회원"), "김총무", T(1)).log!.at(-1)!.text).toBe("승인했습니다");
  });
  it("동기화하면 다른 사람이 올린 기록과 다른 사람의 승인을 누가 했는지와 함께 알려 준다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const mine = pending("김총무");
    const a0 = await syncNow(ws, device([mine]), api(store), T(0));
    expect(a0.news).toEqual(NO_NEWS);
    // 회원 둘이 한 건씩 올리고, 대표가 총무의 지출을 승인한다
    let b = await syncNow(ws, device([]), api(store), T(1));
    expect(b.news).toMatchObject({ added: 1, addedBy: ["김총무"] });
    b = await syncNow(ws, { ...b, expenses: [...b.expenses, { ...pending("이회원"), id: "lee" }, { ...pending("최회원"), id: "choi" }] }, api(store), T(2));
    const approved = touchChanged(b.expenses, b.expenses.map((e) => (e.id === mine.id ? approveExpense(e, "박대표", T(3)) : e)), T(3));
    await syncNow(ws, { ...b, expenses: approved }, api(store), T(3));
    const a1 = await syncNow(ws, a0, api(store), T(4));
    expect(a1.news).toEqual({ ...NO_NEWS, added: 2, addedBy: ["이회원", "최회원"], approved: 1, approvedBy: ["박대표"] });
    // 다시 맞추면 새 소식이 없다
    expect((await syncNow(ws, a1, api(store), T(5))).news).toEqual(NO_NEWS);
  });
  it("승인 방식은 단체 공간으로 다른 기기에 전해진다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    await syncNow(ws, device([base()], { shared: { ...shared, submitterApproves: true } }), api(store));
    const b = await syncNow(ws, device([], { shared: { org: "", projects: [], funder: "", approver: "" }, sharedAt: "" }), api(store));
    expect(b.shared.submitterApproves).toBe(true);
    expect(normalizeSettings({ submitterApproves: "yes" }).submitterApproves).toBe(false);
  });
});

describe("되돌리기", () => {
  const pending = (): Expense => ({ ...confirmExpense({ ...base(), confirmed: false }, "이회원"), updatedAt: T(0) });
  it("사유를 적어 되돌리면 초안으로 돌아가고, 올린 사람에게 사유가 확인할 항목으로 보인다", () => {
    const back = returnExpense(pending(), "박대표", "  참석자 명단을 함께 붙여 주세요  ", T(1));
    expect(back.status).toBe("draft");
    expect(back.confirmed).toBe(false);
    expect(back.returned).toEqual({ by: "박대표", reason: "참석자 명단을 함께 붙여 주세요", at: T(1) });
    expect(openItems(back)[0]).toEqual({ code: "returned", text: "박대표 님이 되돌렸습니다. 사유: 참석자 명단을 함께 붙여 주세요" });
    expect(back.log!.at(-1)).toEqual({ at: T(1), by: "박대표", text: "되돌렸습니다. 사유: 참석자 명단을 함께 붙여 주세요" });
    // 금액이나 내용은 건드리지 않는다
    expect(back.amount).toBe(pending().amount);
  });
  it("사유 없이는 되돌리지 못하고, 승인 대기가 아닌 기록도 되돌리지 못한다", () => {
    const p = pending();
    expect(returnExpense(p, "박대표", "   ")).toBe(p);
    const done = approveExpense(p, "박대표", T(1));
    expect(returnExpense(done, "박대표", "사유")).toBe(done);
    const draft = { ...p, confirmed: false, status: "draft" as const };
    expect(returnExpense(draft, "박대표", "사유")).toBe(draft);
  });
  it("올린 사람이 고쳐서 다시 확정하면 되돌림 표시가 지워지고 다시 승인 대기가 된다. 이력에는 남는다", () => {
    const back = returnExpense(pending(), "박대표", "금액을 다시 확인해 주세요", T(1));
    const again = confirmExpense({ ...back, amount: 25000 }, "이회원");
    expect(again.returned).toBeUndefined();
    expect(again.status).toBe("pending_approval");
    expect(openItems(again).some((o) => o.code === "returned")).toBe(false);
    expect(again.log!.some((l) => l.text.startsWith("되돌렸습니다"))).toBe(true);
  });
  it("되돌린 것은 올린 사람의 기기로 전해지고, 누가 되돌렸는지 알려 준다. 그 사이 올린 사람이 고친 다른 칸은 남는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const a0 = await syncNow(ws, device([pending()]), api(store), T(0));
    const b0 = await syncNow(ws, device([]), api(store), T(0));
    // 올린 사람은 연결이 끊긴 채 목적을 고치고, 승인하는 사람은 되돌린다
    const mine = touchChanged(a0.expenses, [{ ...a0.expenses[0], purpose: "고친 목적" }], T(1));
    const back = touchChanged(b0.expenses, [returnExpense(b0.expenses[0], "박대표", "영수증이 흐립니다", T(2))], T(2));
    await syncNow(ws, { ...b0, expenses: back }, api(store), T(2));
    const a1 = await syncNow(ws, { ...a0, expenses: mine }, api(store), T(3));
    expect(a1.news).toEqual({ ...NO_NEWS, returned: 1, returnedBy: ["박대표"] });
    expect(a1.expenses[0]).toMatchObject({ purpose: "고친 목적", confirmed: false, status: "draft", returned: { by: "박대표", reason: "영수증이 흐립니다" } });
    expect((await syncNow(ws, a1, api(store), T(4))).news).toEqual(NO_NEWS);
  });
});

