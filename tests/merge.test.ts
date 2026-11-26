// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 두 기기가 같은 기록을 고쳤을 때: 서로 다른 칸이면 둘 다 남고, 같은 칸이면 나중 것이 남는다.
 * 승인한 뒤 다른 기기에서 내용이 바뀌었으면 승인이 풀린다.
 */
import { describe, expect, it } from "vitest";
import { describeChanges, logEdits } from "@/lib/history";
import { recordDigest } from "@/lib/ledger";
import { demoSnackExpense } from "@/lib/seed";
import { approveExpense, confirmExpense } from "@/lib/status";
import { syncNow, type SyncApi, type SyncLocal } from "@/lib/sync-client";
import { newWorkspace } from "@/lib/sync-crypto";
import { mergeExpenses, mergeRecord, touchChanged } from "@/lib/sync-merge";
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
    getDoc: async (id) => out(await getDoc(store, id)), putDoc: async (id, t, b) => out(await putDoc(store, id, t, b)),
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
