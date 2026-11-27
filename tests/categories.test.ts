// SPDX-License-Identifier: GPL-3.0-or-later
/** 예산 항목: 기본 목록, 더하고 빼기, 에이전트가 낸 이름을 목록의 항목으로 맞추기. */
import { describe, expect, it } from "vitest";
import { addCategory, categoryChoices, DEFAULT_CATEGORIES, matchCategory, normalizeCategories, removeCategory } from "@/lib/categories";
import { normalizeSettings } from "@/lib/settings";

describe("예산 항목 목록", () => {
  it("정한 적이 없으면 기본 항목을 쓰고, 정했으면 그 목록을 쓴다 (다 빼서 비운 것도 존중한다)", () => {
    expect(normalizeCategories(undefined)).toEqual([...DEFAULT_CATEGORIES]);
    expect(normalizeSettings({}).categories).toEqual([...DEFAULT_CATEGORIES]);
    expect(normalizeCategories([])).toEqual([]);
    expect(normalizeCategories([" 교육비 ", "교육비", "", 3, "식비"])).toEqual(["교육비", "식비"]);
  });
  it("더하고 뺀다. 고를 수 있는 목록에는 이미 쓰인 항목도 들어간다", () => {
    const list = addCategory([...DEFAULT_CATEGORIES], "장학금");
    expect(list.at(-1)).toBe("장학금");
    expect(addCategory(list, "장학금")).toEqual(list);
    expect(removeCategory(list, "숙박비")).not.toContain("숙박비");
    expect(categoryChoices(["식비·다과비"], ["세미나", "", "식비·다과비"])).toEqual(["식비·다과비", "세미나"]);
  });
});

describe("에이전트가 낸 예산 항목을 목록에 맞추기", () => {
  const list = [...DEFAULT_CATEGORIES];
  it("목록에 있으면 그대로, 표기만 다르면 그 항목으로", () => {
    expect(matchCategory("식비·다과비", list)).toBe("식비·다과비");
    expect(matchCategory("여비 교통비", list)).toBe("여비·교통비");
    expect(matchCategory("교통비", list)).toBe("여비·교통비");
    expect(matchCategory("숙박", list)).toBe("숙박비");
    expect(matchCategory("홍보/인쇄비", list)).toBe("홍보·인쇄비");
  });
  it("뜻이 같은 항목을 찾는다", () => {
    expect(matchCategory("식사", list)).toBe("식비·다과비");
    expect(matchCategory("간식비", list)).toBe("식비·다과비");
    expect(matchCategory("세미나", list)).toBe("회의·행사비");
    expect(matchCategory("교육비", list)).toBe("회의·행사비");
    expect(matchCategory("택시비", list)).toBe("여비·교통비");
    expect(matchCategory("현수막 제작", list)).toBe("홍보·인쇄비");
    expect(matchCategory("강사료", list)).toBe("강사비·사례비");
    expect(matchCategory("장소 대여", list)).toBe("대관·임차료");
    expect(matchCategory("문구류", list)).toBe("물품·재료비");
  });
  it("맞는 것이 없으면 기타, 기타도 없으면 낸 이름 그대로", () => {
    expect(matchCategory("후원금 반환", list)).toBe("기타");
    expect(matchCategory("후원금 반환", ["식비·다과비"])).toBe("후원금 반환");
    expect(matchCategory("식사", ["교육비", "식사", "세미나"])).toBe("식사"); // 단체가 정한 이름이 먼저다
    expect(matchCategory("세미나실 대여", ["교육비", "식사", "세미나"])).toBe("세미나"); // 항목 이름을 품은 더 긴 이름
    expect(matchCategory("", list)).toBe("");
    expect(matchCategory("아무거나", [])).toBe("아무거나");
  });
});

/* ---------- 에이전트가 목록에서 고르는지 ---------- */
import { vi } from "vitest";
import { runExpenseAgent } from "@/lib/agent";
import { type LinerDeps } from "@/lib/liner";

describe("지출 에이전트가 예산 항목을 단체의 목록에서 끌어다 쓴다", () => {
  const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  let n = 0;
  const turn = (...calls: [string, object][]) => () =>
    jsonRes({ choices: [{ message: { role: "assistant", content: null, tool_calls: calls.map(([name, args]) => ({ id: `c${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } }] });
  function fake(turns: (() => Response)[]) {
    const bodies: any[] = [];
    let i = 0;
    const deps: LinerDeps = { apiKey: "k", model: "m", sleep: vi.fn(async () => {}), timeoutMs: 30_000, fetch: (async (_u: any, init: any) => { bodies.push(JSON.parse(init.body)); return turns[i++](); }) as typeof fetch };
    return { deps, bodies };
  }
  const ev = { kind: "receipt" as const, hasImage: false, hasReason: false };
  const base = { date: "2026-11-18", amount: 26400, item: "다과", project: "워크숍", paymentMethod: "cash" };

  it("목록을 도구 설명에 실어 보내고, 모델이 목록에 없는 이름을 내도 목록의 항목으로 맞춘다", async () => {
    const f = fake([turn(["lookup_history", {}], ["update_record", { budgetCategory: "식사" }]), turn(["finish", { summary: "다과를 샀습니다.", checklist: [] }])]);
    const out = await runExpenseAgent({ messages: [{ role: "user", content: "x" }], record: base, evidence: ev, categories: [...DEFAULT_CATEGORIES], canAsk: false }, f.deps);
    expect(out.record.budgetCategory).toBe("식비·다과비");
    expect(out.aiFields).toContain("budgetCategory");
    const spec = f.bodies[0].tools.find((t: any) => t.function.name === "update_record").function.parameters.properties.budgetCategory;
    expect(spec.enum).toEqual([...DEFAULT_CATEGORIES]);
    // 지난 기록을 볼 때도 고를 수 있는 항목을 함께 알려 준다
    expect(JSON.stringify(f.bodies[1].messages)).toContain("allowedBudgetCategories");
  });

  it("사람이 넣은 예산 항목은 그대로 두고, 목록을 받지 못했으면(바깥에서 부른 경우) 모델이 낸 이름을 그대로 쓴다", async () => {
    let f = fake([turn(["update_record", { budgetCategory: "식사" }]), turn(["finish", { summary: "요약", checklist: [] }])]);
    let out = await runExpenseAgent({ messages: [{ role: "user", content: "x" }], record: { ...base, budgetCategory: "장학금" }, locked: ["budgetCategory"], evidence: ev, categories: [...DEFAULT_CATEGORIES], canAsk: false }, f.deps);
    expect(out.record.budgetCategory).toBe("장학금");
    f = fake([turn(["update_record", { budgetCategory: "식사" }]), turn(["finish", { summary: "요약", checklist: [] }])]);
    out = await runExpenseAgent({ messages: [{ role: "user", content: "x" }], record: base, evidence: ev, canAsk: false }, f.deps);
    expect(out.record.budgetCategory).toBe("식사");
    expect(f.bodies[0].tools.find((t: any) => t.function.name === "update_record").function.parameters.properties.budgetCategory.enum).toBeUndefined();
  });
});
