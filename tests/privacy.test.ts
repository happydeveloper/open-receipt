// SPDX-License-Identifier: GPL-3.0-or-later
/** 모델로 보내는 글에서 이름과 번호를 지우고, 받은 답에서 되돌리는지. */
import { describe, expect, it } from "vitest";
import { createVault, hideMessages, looksPersonal, suggestMaskBoxes, type TextSpot } from "@/lib/privacy";

describe("개인정보 자리표", () => {
  it("아는 이름과 호칭이 붙은 이름을 자리표로 바꾸고, 되돌리면 원래대로다", () => {
    const v = createVault();
    v.learn(["김영희", "", undefined, "담당자", "김○○"]);
    const text = "김영희 간사가 결제했고 박철수 님이 확인했습니다. 담당자님께 전달. 김영희에게 환급";
    const hidden = v.hide(text);
    expect(hidden).toBe("[사람1] 간사가 결제했고 [사람2] 님이 확인했습니다. 담당자님께 전달. [사람1]에게 환급");
    expect(hidden).not.toMatch(/김영희|박철수/);
    expect(v.show(hidden)).toBe(text);
    // 모델이 자리표로 답하면 원래 이름으로 돌아온다
    expect(v.show('{"payer":"[사람2]","purpose":"[사람1] 요청"}')).toBe('{"payer":"박철수","purpose":"김영희 요청"}');
    expect(v.show("[사람9]")).toBe("[사람9]"); // 모르는 자리표는 그대로
    expect(v.counts()).toEqual({ 사람: 2 });
  });

  it("역할 이름과 가린 이름은 이름으로 보지 않고, 다른 낱말 속의 글자는 건드리지 않는다", () => {
    const v = createVault();
    v.learn(["대표", "김○○", "이수"]);
    expect(v.hide("대표님과 총무님, 회원 여러분께")).toBe("대표님과 총무님, 회원 여러분께");
    expect(v.hide("박대표 님 승인")).toBe("[사람2] 님 승인");
    expect(v.hide("이수 님이 연수 이수증을 냈다")).toBe("[사람1] 님이 연수 [사람1]증을 냈다"); // 낱말 앞머리는 구분하지 못한다 (되돌리면 원래대로라 문제없다)
    expect(v.show(v.hide("이수 님이 연수 이수증을 냈다"))).toBe("이수 님이 연수 이수증을 냈다");
    expect(v.hide("재이수 과정")).toBe("재이수 과정");
  });

  it("주민번호, 카드번호, 전화번호, 계좌번호, 메일을 지우고 날짜와 금액은 둔다", () => {
    const v = createVault();
    const text = "2026-11-25 33,000원 카드 1234-5678-9012-3456, 휴대폰 010-1234-5678, 사무실 02-345-6789, 계좌 110-234-567890, 메일 kim@example.org, 주민 900101-1234567, 사업자 123-45-67890";
    const hidden = v.hide(text);
    expect(hidden).toBe("2026-11-25 33,000원 카드 [카드번호1], 휴대폰 [전화번호1], 사무실 [전화번호2], 계좌 [번호1], 메일 [메일1], 주민 [주민번호1], 사업자 [번호2]");
    expect(v.show(hidden)).toBe(text);
    expect(v.hide("승인번호 12345678, 금액 1200000, 2026-01-02")).toBe("승인번호 12345678, 금액 1200000, 2026-01-02");
    expect(v.hide("카드 5412-12**-****-3456")).toBe("카드 [카드번호2]");
    expect(v.hide('{"amount":1763000000000}')).toBe('{"amount":1763000000000}'); // 숫자 값은 건드리지 않는다
  });

  it("검색어에서는 자리표를 아예 뺀다", () => {
    const v = createVault();
    v.learn(["김영희"]);
    expect(v.strip("김영희 간사 010-1234-5678 다과 구입 증빙 지침")).toBe("간사 다과 구입 증빙 지침");
  });

  it("메시지 목록의 글과 도구 호출 인자를 가리고, 사진과 원래 목록은 그대로 둔다", () => {
    const v = createVault();
    v.learn(["김영희"]);
    const image = { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } };
    const messages = [
      { role: "user", content: [{ type: "text", text: "메모: 김영희 결제 010-1234-5678" }, image] },
      { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "update_record", arguments: '{"payer":"김영희"}' } }] },
      { role: "tool", tool_call_id: "c1", content: '{"record":{"payer":"김영희"}}' },
    ];
    const out = hideMessages(v, messages);
    const sent = JSON.stringify(out);
    expect(sent).not.toContain("김영희");
    expect(sent).not.toContain("010-1234-5678");
    expect(out[0].content[1]).toBe(image);
    expect(out[1].tool_calls[0].function.arguments).toBe('{"payer":"[사람1]"}');
    expect(JSON.stringify(messages)).toContain("김영희"); // 원래 목록은 그대로다
  });
});

describe("PDF에서 가릴 곳 제안", () => {
  const spot = (text: string, x: number, y: number, w = 0.12, h = 0.02): TextSpot => ({ text, x, y, w, h });
  it("번호와 메일, 그리고 수령인·연락처·주소 칸의 값을 가리고 품목과 금액은 둔다", () => {
    const spots = [
      spot("거래명세서", 0.1, 0.05),
      spot("수령인", 0.1, 0.12), spot("홍길동", 0.25, 0.12), spot("연락처", 0.5, 0.12), spot("010-1234-5678", 0.62, 0.12),
      spot("배송지", 0.1, 0.16), spot("서울시 가상구", 0.25, 0.16), spot("예시로 1, 101동", 0.4, 0.16, 0.2),
      spot("주문자: 김영희", 0.1, 0.2, 0.2),
      spot("품목", 0.1, 0.3), spot("과자 모둠 세트", 0.25, 0.3), spot("12,000원", 0.7, 0.3),
      spot("주문일 2026-11-18", 0.1, 0.36, 0.2), spot("문의 help@example.org", 0.5, 0.36, 0.25),
    ];
    const boxes = suggestMaskBoxes(spots);
    const covers = (text: string) => { const s = spots.find((x) => x.text === text)!; return boxes.some((b) => b.x <= s.x && b.y <= s.y && b.x + b.w >= s.x + s.w && b.y + b.h >= s.y + s.h); };
    for (const t of ["홍길동", "010-1234-5678", "서울시 가상구", "예시로 1, 101동", "주문자: 김영희", "문의 help@example.org"]) expect(covers(t), t).toBe(true);
    for (const t of ["거래명세서", "수령인", "연락처", "품목", "과자 모둠 세트", "12,000원", "주문일 2026-11-18"]) expect(covers(t), t).toBe(false);
    expect(boxes).toHaveLength(5); // 나란히 붙은 주소 두 토막은 한 상자로 합친다
    // 낱말마다 토막이 나뉜 PDF에서도 줄을 이어 붙여 찾는다
    const split = [spot("받는", 0.1, 0.5, 0.04), spot("분", 0.15, 0.5, 0.02), spot("김가상", 0.19, 0.5, 0.06), spot("·", 0.26, 0.5, 0.01), spot("010-", 0.3, 0.5, 0.04), spot("1234-5678", 0.34, 0.5, 0.09)];
    const found = suggestMaskBoxes(split);
    expect(found).toHaveLength(1);
    expect(found[0].x).toBeGreaterThan(0.17); // 칸 이름("받는 분")은 가리지 않는다
    expect(found[0].x + found[0].w).toBeGreaterThan(0.43);
    for (const b of boxes) { expect(b.x).toBeGreaterThanOrEqual(0); expect(b.x + b.w).toBeLessThanOrEqual(1); }
  });
  it("가릴 것이 없거나 글자가 없으면 비어 있다", () => {
    expect(suggestMaskBoxes([])).toEqual([]);
    expect(suggestMaskBoxes([spot("합계 26,400원", 0.1, 0.1), spot("2026-11-18", 0.1, 0.2)])).toEqual([]);
    expect(looksPersonal("승인번호 30112233")).toBe(false);
    expect(looksPersonal("010 1234 5678")).toBe(true);
  });
});

/* ---------- 실제 에이전트가 모델과 검색으로 보내는 것 ---------- */
import { vi } from "vitest";
import { expenseKickoffText, runCloseAgent, runExpenseAgent, runGroupAgent } from "@/lib/agent";
import { MODEL_URL, SEARCH_URL, type LinerDeps } from "@/lib/liner";
import { seedExpenses } from "@/lib/seed";

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
let n = 0;
const turn = (...calls: [string, object][]) => () =>
  jsonRes({ choices: [{ message: { role: "assistant", content: null, tool_calls: calls.map(([name, args]) => ({ id: `call_${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } }] });
function fake(turns: (() => Response)[]) {
  const sent: string[] = [];
  let i = 0;
  const deps: LinerDeps = {
    apiKey: "test-key", model: "liner-gpt-router", sleep: vi.fn(async () => {}), timeoutMs: 30_000,
    fetch: (async (url: any, init: any) => {
      sent.push(`${url} ${init.body}`);
      if (String(url) === SEARCH_URL) return jsonRes({ results: [{ title: "회계 안내", url: "https://example.go.kr/a", description: "선결제는 이체 확인증 보관" }] });
      const next = turns[i++];
      if (!next) throw new Error("모델 호출이 예상보다 많습니다");
      return next();
    }) as typeof fetch,
  };
  return { deps, sent, all: () => sent.join("\n"), model: () => sent.filter((s) => s.startsWith(MODEL_URL)).join("\n"), search: () => sent.filter((s) => s.startsWith(SEARCH_URL)).join("\n") };
}
const PII = ["김영희", "박철수", "이민수", "010-1234-5678", "110-234-567890", "kim@example.org", "900101-1234567", "1234-5678-9012-3456"];
const leaks = (text: string) => PII.filter((p) => text.includes(p));

describe("에이전트가 모델과 검색으로 보내는 글에 개인정보가 없다", () => {
  it("지출 에이전트: 메모와 기록의 이름·번호는 자리표로 나가고, 모델이 자리표로 채운 결제자는 원래 이름으로 기록된다", async () => {
    const memo = "김영희 간사가 개인카드 1234-5678-9012-3456 로 결제, 연락처 010-1234-5678, 환급 계좌 110-234-567890 (kim@example.org)";
    const record = { item: "다과", purpose: "박철수 님 요청으로 구입", merchant: "행복상회 02-345-6789" };
    const f = fake([
      // 모델은 자리표만 보았으므로 결제자를 자리표로 채운다
      turn(["update_record", { date: "2026-11-18", amount: 26400, paymentMethod: "personal", project: "자원봉사자 워크숍", payer: "[사람1]", reimbursement: "needed", docType: "카드영수증" }]),
      turn(["search_guidelines", { query: "[사람1] 간사 개인카드 선결제 다과 정산 증빙 지침 010-1234-5678" }]),
      turn(["finish", { summary: "[사람1] 간사가 워크숍 다과를 개인카드로 먼저 결제했습니다.", checklist: [] }]),
    ]);
    const out = await runExpenseAgent({ messages: [{ role: "user", content: expenseKickoffText(memo, record, [], { kind: "receipt", hasImage: false, hasReason: false }, false) }], record, evidence: { kind: "receipt", hasImage: false, hasReason: false } }, f.deps);
    expect(leaks(f.all())).toEqual([]);
    expect(f.model()).toContain("[사람1]");
    expect(f.model()).not.toContain("02-345-6789"); // 가게 전화번호도 번호 모양이면 가린다
    expect(f.search()).not.toMatch(/\[사람|\[전화/); // 검색어에는 자리표도 남기지 않는다
    expect(f.search()).toContain("개인카드 선결제 다과 정산 증빙 지침");
    // 기록과 요약에는 원래 이름이 돌아와 있다
    expect(out.record.payer).toBe("김영희");
    expect(out.summary).toContain("김영희 간사가");
    expect(out.record.purpose).toBe("박철수 님 요청으로 구입"); // 사람이 적은 값은 그대로다
    expect(out.record.merchant).toBe("행복상회 02-345-6789");
  });

  it("마감 점검 에이전트: 결제자·제출자·승인자 이름은 자리표로 나가고, 요청 문안과 받는 사람에는 원래 이름이 들어간다", async () => {
    const records = seedExpenses().map((e, i) => ({ ...e, project: "자원봉사자 워크숍", payer: i === 0 ? "김영희" : "이민수", submittedBy: "김영희", approvedBy: i === 0 ? "박철수" : undefined, purpose: `${e.purpose} (문의 010-1234-5678)` }));
    const open = records.find((e) => e.status !== "done")!;
    const f = fake([
      turn(["list_records", {}]),
      turn(["inspect_record", { id: open.id }]),
      turn(["draft_request", { id: open.id, to: "[사람1]", message: "[사람1] 님, 이체확인증을 첨부해 주세요." }]),
      turn(["finish", { briefing: "보완이 필요한 건은 1건이며 [사람1] 님께 요청했습니다." }]),
    ]);
    const out = await runCloseAgent({ project: "자원봉사자 워크숍", records }, f.deps);
    expect(leaks(f.all())).toEqual([]);
    expect(f.model()).toMatch(/\[사람\d\]/);
    expect(out.requests[0].to).toBe("김영희");
    expect(out.requests[0].message).toBe("김영희 님, 이체확인증을 첨부해 주세요.");
    expect(out.briefing).toContain("김영희 님께 요청했습니다");
  });

  it("묶음 에이전트: 가맹점과 항목에 섞인 번호는 나가지 않는다", async () => {
    const f = fake([turn(["list_documents", {}]), turn(["finish", { note: "묶을 서류가 없습니다." }])]);
    await runGroupAgent({ documents: [
      { id: "a", date: "2026-11-19", amount: 33000, merchant: "현수막나라 010-1234-5678", item: "현수막 (담당 kim@example.org)", payment: "조직카드", docType: "카드영수증", photos: 1 },
      { id: "b", date: "2026-11-19", amount: 33000, merchant: "현수막나라", item: "현수막", payment: "", docType: "거래명세서", photos: 1 },
    ] as any }, f.deps);
    expect(leaks(f.all())).toEqual([]);
  });
});
