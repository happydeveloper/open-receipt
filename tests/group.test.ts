// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 같은 거래의 서류 묶기: 제안 검증, 합치기 규칙, 묶음 에이전트(가짜 Liner 응답)와 AG-UI 왕복.
 */
import { describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { EventSchemas } from "@ag-ui/core/schemas";
import { runExpenseAgent, runGroupAgent } from "@/lib/agent";
import { handleGroupRun } from "@/lib/agui-server";
import { amountMismatch, cleanProposals, groupable, mergeGroup, pickMain, stillValid, toGroupDocs, type GroupDoc } from "@/lib/group";
import { MODEL_URL, type LinerDeps } from "@/lib/liner";
import { photosOf } from "@/lib/photos";
import { buildReport } from "@/lib/report";
import { approveExpense, confirmExpense, newExpense } from "@/lib/status";
import type { Expense } from "@/lib/types";

const img = (c: string) => "data:image/jpeg;base64," + c.repeat(600);
const PROJECT = "자원봉사자 워크숍";
/** 같은 거래의 서류 세 장(카드영수증, 거래명세서, 주문 화면)과 다른 거래 한 장. */
function papers(): Expense[] {
  const base = { project: PROJECT, paymentMethod: "org_card" as const, submittedBy: "김총무" };
  return [
    newExpense({ ...base, id: "card", date: "2026-11-19", amount: 26400, merchant: "가상페이", item: "", aiDrafted: ["date", "amount", "merchant"], evidence: { kind: "receipt", image: img("C"), original: true, docType: "카드영수증" } }),
    newExpense({ ...base, id: "stmt", date: "2026-11-18", amount: 26400, merchant: "가상몰(주)", item: "행사 다과", budgetCategory: "회의·행사비", aiDrafted: ["item", "budgetCategory"], evidence: { kind: "receipt", image: img("S"), docType: "거래명세서" } }),
    newExpense({ ...base, id: "shot", date: "2026-11-18", amount: 26400, merchant: "가상몰", item: "과자 모둠 세트 외", purpose: "워크숍 다과 구매", evidence: { kind: "receipt", image: img("W"), original: true, docType: "주문내역", extra: [{ id: "p2", label: "기타", image: img("X") }] } }),
    newExpense({ ...base, id: "other", date: "2026-11-18", amount: 18000, merchant: "가상인쇄", item: "현수막", evidence: { kind: "receipt", image: img("O"), docType: "간이영수증" } }),
  ];
}
const docs = () => toGroupDocs(papers());

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let n = 0;
const turn = (...calls: [string, object][]) => () =>
  jsonRes({ choices: [{ message: { role: "assistant", content: null, tool_calls: calls.map(([name, args]) => ({ id: `call_g${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } }] });
function fake(turns: (() => Response)[]) {
  const calls: any[] = [];
  let i = 0;
  const deps: LinerDeps = {
    apiKey: "test-key", model: "liner-gpt-router", sleep: vi.fn(async () => {}), timeoutMs: 30_000,
    fetch: (async (url: any, init: any) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); const t = turns[i++]; if (!t) throw new Error("모델 호출이 예상보다 많습니다"); return t(); }) as typeof fetch,
  };
  return { deps, calls };
}

describe("묶음 제안 검증", () => {
  it("합칠 수 있는 기록만 서류 목록에 든다: 승인 전이고, 사진이 이 기기에 있다", () => {
    const [card] = papers();
    expect(groupable(card)).toBe(true);
    expect(groupable(approveExpense(confirmExpense({ ...card, item: "다과" }, "김총무"), "박대표"))).toBe(false);
    expect(groupable({ ...card, evidence: { kind: "receipt", image: "sync:image" } })).toBe(false);
    expect(groupable(newExpense({ id: "x", evidence: { kind: "alternative", altType: "사유서", reason: "분실" } }))).toBe(false);
    expect(docs().find((d) => d.id === "shot")).toMatchObject({ docType: "주문내역", photos: 2, payment: "조직카드" });
  });
  it("없는 서류, 한 장짜리, 다른 묶음에 이미 든 서류는 버린다", () => {
    const out = cleanProposals(
      [
        { ids: ["card", "stmt", "ghost"], mainId: "ghost", reason: "금액이 같고 하루 차이입니다." },
        { ids: ["stmt", "other"], reason: "겹침" }, // stmt는 이미 들어갔다 → 한 장만 남아 버려진다
        { ids: ["shot"], reason: "한 장" },
        "엉뚱한 값",
      ],
      docs(),
    );
    expect(out).toHaveLength(1);
    expect(out[0].ids).toEqual(["card", "stmt"]);
    expect(out[0].mainId).toBe("card"); // 없는 대표는 결제를 증명하는 서류로 바꾼다
    expect(out[0].mismatch).toBe("");
    expect(cleanProposals(undefined, docs())).toEqual([]);
  });
  it("금액이 다르면 코드가 직접 적고, 판정하는 말은 고쳐 쓴다", () => {
    const d: GroupDoc[] = docs().map((x) => (x.id === "stmt" ? { ...x, amount: 29400 } : x));
    expect(amountMismatch(d.filter((x) => x.id !== "other"))).toBe("금액이 서로 다릅니다: 26,400원, 29,400원");
    const [g] = cleanProposals([{ ids: ["card", "stmt"], reason: "이 지출은 규정 위반입니다", mismatch: "배송비 3,000원으로 보입니다" }], d);
    expect(g.mismatch).toBe("금액이 서로 다릅니다: 26,400원, 29,400원 · 배송비 3,000원으로 보입니다");
    expect(g.reason).not.toContain("위반");
  });
  it("대표는 카드영수증 > 간이영수증 > 종류 모름 > 이체확인증 > 거래명세서 > 주문내역 순으로 고른다", () => {
    const d = docs();
    expect(pickMain(d.filter((x) => ["stmt", "shot"].includes(x.id)))).toBe("stmt");
    expect(pickMain(d)).toBe("card");
  });
  it("제안을 받은 뒤 기록이 지워졌으면 그 제안은 더 쓰지 않는다", () => {
    const [g] = cleanProposals([{ ids: ["card", "stmt", "shot"], reason: "같은 거래" }], docs());
    expect(stillValid([g], docs())).toEqual([g]);
    expect(stillValid([g], docs().filter((d) => d.id !== "shot"))).toEqual([]);
    expect(stillValid("x", docs())).toEqual([]);
  });
});

describe("한 건으로 합치기", () => {
  it("세 건이 한 건이 되고, 금액은 더하지 않으며, 사진 네 장이 모두 남는다", () => {
    const list = papers();
    const [card, stmt, shot, other] = list;
    expect(buildReport(list, PROJECT)).toMatchObject({ count: 4, total: 26400 * 3 + 18000 });
    let k = 0;
    const { merged, removed, moves } = mergeGroup(card, [stmt, shot], "김총무", () => `a${++k}`, "2026-11-25T00:00:00.000Z");
    const after = [merged, other];
    expect(buildReport(after, PROJECT)).toMatchObject({ count: 2, total: 26400 + 18000 });
    expect(removed).toEqual(["stmt", "shot"]);
    expect(photosOf(merged).map((p) => [p.key, p.label])).toEqual([["card", "카드영수증"], ["card-x-a1", "거래명세서"], ["card-x-a2", "주문내역"], ["card-x-a3", "기타"]]);
    expect(photosOf(merged).map((p) => p.image)).toEqual([img("C"), img("S"), img("W"), img("X")]);
    // 원본이 있던 사진만 새 이름으로 옮긴다
    expect(moves).toEqual([{ from: "shot", to: "card-x-a2" }]);
    expect(merged.log!.at(-1)!.text).toContain("서류 3건을 한 건으로 합쳤습니다");
  });
  it("남는 기록의 빈 칸만 다른 서류의 값으로 채운다. 이미 있는 값은 바꾸지 않는다", () => {
    const [card, stmt, shot] = papers();
    const { merged } = mergeGroup(card, [stmt, shot], "김총무");
    expect(merged).toMatchObject({ date: "2026-11-19", merchant: "가상페이", amount: 26400, item: "행사 다과", budgetCategory: "회의·행사비", purpose: "워크숍 다과 구매" });
    // AI가 읽은 값은 옮겨 와도 AI 초안 표시가 남고, 사람이 넣은 값에는 붙지 않는다
    expect(merged.aiDrafted).toEqual(expect.arrayContaining(["item", "budgetCategory", "date"]));
    expect(merged.aiDrafted).not.toContain("purpose");
    expect(merged.confirmed).toBe(false);
  });
});

describe("묶음 에이전트", () => {
  it("서류 목록을 보고 묶음을 제안한다. 사진은 보내지 않고, 기록을 바꾸는 도구가 없다", async () => {
    const f = fake([
      turn(["list_documents", {}]),
      turn(["propose_group", { ids: ["card", "stmt", "shot"], mainId: "card", reason: "세 서류의 금액이 26,400원으로 같고 날짜가 하루 차이입니다.", mismatch: "" }]),
      turn(["propose_group", { ids: ["shot", "other"], reason: "같은 날" }]), // shot은 이미 묶였다 → 거절
      turn(["finish", { note: "묶음 1개를 찾았습니다." }]),
    ]);
    const steps: string[] = [];
    const out = await runGroupAgent({ documents: docs() }, f.deps, { onStep: (s) => void steps.push(s.label) });
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]).toMatchObject({ ids: ["card", "stmt", "shot"], mainId: "card" });
    expect(out.note).toBe("묶음 1개를 찾았습니다.");
    expect(steps).toEqual(["서류 4장을 훑었습니다", "서류 3장을 한 거래로 제안했습니다", "묶음 1개를 찾았습니다"]);
    // 모델에 간 것: Model API, 도구 세 개, 사진 없음
    expect(f.calls.every((c) => c.url === MODEL_URL)).toBe(true);
    expect(f.calls[0].body.tools.map((t: any) => t.function.name)).toEqual(["list_documents", "propose_group", "finish"]);
    expect(JSON.stringify(f.calls.map((c) => c.body))).not.toContain("data:image");
    // 거절된 제안에는 이유를 돌려준다
    const rejected = f.calls[3].body.messages.findLast((m: any) => m.role === "tool");
    expect(rejected.content).toContain("받을 수 없는 묶음");
  });
  it("서류가 한 장뿐이면 모델을 부르지 않는다", async () => {
    const f = fake([]);
    expect(await runGroupAgent({ documents: docs().slice(0, 1) }, f.deps)).toEqual({ groups: [], note: "견줄 서류가 두 장보다 적습니다." });
    expect(f.calls).toHaveLength(0);
  });
  it("AG-UI 왕복: 공식 클라이언트로 부르면 상태에 묶음이 실려 오고, 모든 이벤트가 규격에 맞다", async () => {
    const f = fake([turn(["list_documents", {}], ["propose_group", { ids: ["card", "stmt"], reason: "금액과 가맹점이 맞습니다." }]), turn(["finish", {}])]);
    const events: any[] = [];
    const agent = new HttpAgent({ url: "http://test.local/api/agent/group", threadId: "t-group", initialState: { documents: docs() } });
    agent.fetch = (async (url: any, init: any) => handleGroupRun(new Request(String(url), { method: "POST", headers: init.headers, body: init.body }), f.deps)) as any;
    agent.addMessage({ id: "u1", role: "user", content: "같은 거래를 찾아 주세요." } as any);
    await agent.runAgent({ tools: [] }, { onEvent: ({ event }) => void events.push(event) });
    for (const e of events) expect(EventSchemas.safeParse(e).success, e.type).toBe(true);
    expect(events[0].type).toBe("RUN_STARTED");
    expect(events.at(-1).type).toBe("RUN_FINISHED");
    expect((agent.state as any).groups).toEqual([{ ids: ["card", "stmt"], mainId: "card", reason: "금액과 가맹점이 맞습니다.", mismatch: "" }]);
    expect((agent.state as any).note).toContain("묶음 1개");
    // state.documents가 없으면 실행 전에 거절한다
    const bad = await handleGroupRun(new Request("http://test.local/x", { method: "POST", body: JSON.stringify({ threadId: "t", runId: "r", messages: [], tools: [], context: [], state: {} }) }), f.deps);
    expect(bad.status).toBe(400);
  });
});

describe("서류 종류 읽기", () => {
  it("지출 에이전트가 기록을 채울 때 서류 종류도 함께 돌려준다. 목록에 없는 종류는 받지 않는다", async () => {
    const f = fake([
      turn(["update_record", { date: "2026-11-18", amount: 26400, merchant: "가상몰(주)", docType: "거래명세서" }]),
      turn(["update_record", { item: "행사 다과", docType: "세금폭탄서" }]),
      turn(["finish", { summary: "행사 다과 구입.", checklist: [] }]),
    ]);
    const seen: string[] = [];
    const out = await runExpenseAgent({ messages: [{ role: "user", content: "영수증" }], record: {}, evidence: { kind: "receipt", hasImage: true, hasReason: false }, canAsk: false }, f.deps, { onDocType: (d) => void seen.push(d) });
    expect(out.docType).toBe("거래명세서");
    expect(seen).toEqual(["거래명세서"]);
    expect(out.record).toMatchObject({ amount: 26400, item: "행사 다과" });
    expect((out.record as any).docType).toBeUndefined(); // 기록 값에는 섞이지 않는다
  });
});
