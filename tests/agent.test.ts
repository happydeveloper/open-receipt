// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 에이전트와 AG-UI 서버. Liner 응답을 가짜로 넣고, 공식 클라이언트(HttpAgent)로 실제 왕복시켜
 * 이벤트 순서와 형식, 질문 처리, 오류 처리, 호출 한도 규칙을 확인한다.
 */
import { describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { EventSchemas } from "@ag-ui/core/schemas";
import { MODEL_URL, SEARCH_URL, type LinerDeps } from "@/lib/liner";
import { MAX_TURNS, runCloseAgent, runExpenseAgent, type AgentStep } from "@/lib/agent";
import { ASK_USER_TOOL, handleCloseRun, handleExpenseRun, preflight, toModelMessages } from "@/lib/agui-server";
import { demoSnackExpense, seedExpenses } from "@/lib/seed";

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let n = 0;
const turn = (...calls: [string, object][]) =>
  jsonRes({ choices: [{ message: { role: "assistant", content: null, tool_calls: calls.map(([name, args]) => ({ id: `call_${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } })) } }] });

/** 모델 응답을 순서대로 돌려주는 가짜 Liner. */
function fake(modelTurns: (() => Response)[], searches: object[][] = []) {
  const calls: { url: string; body: any; headers: any }[] = [];
  let mi = 0, si = 0;
  const deps: LinerDeps = {
    apiKey: "test-key", model: "liner-gpt-router", sleep: vi.fn(async () => {}), timeoutMs: 30_000,
    fetch: (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
      if (String(url) === SEARCH_URL) return jsonRes({ results: searches[si++] ?? [] });
      const next = modelTurns[mi++];
      if (!next) throw new Error("모델 호출이 예상보다 많습니다");
      return next();
    }) as typeof fetch,
  };
  return { deps, calls, modelCalls: () => calls.filter((c) => c.url === MODEL_URL), searchCalls: () => calls.filter((c) => c.url === SEARCH_URL) };
}

const history = [
  { project: "자원봉사자 워크숍", item: "인쇄물", budgetCategory: "홍보·인쇄비", paymentMethod: "org_card", amount: 18000, date: "2026-11-18" },
  { project: "자원봉사자 워크숍", item: "교통비", budgetCategory: "여비·교통비", paymentMethod: "transfer", amount: 12500, date: "2026-11-19" },
];
const receipt = { kind: "receipt" as const, hasImage: true, hasReason: false };
const guide = [
  { title: "지원사업 회계 안내", url: "https://example.go.kr/a", description: "선결제는 환급 이체 확인증을 보관", date: "2026-04-15" },
  { title: "회계 실무", url: "https://example.org/b", description: "다과비는 참석 인원 기록" },
];
const askTool = { name: ASK_USER_TOOL, description: "사용자에게 묻는다", parameters: { type: "object", properties: {} } };

/** 공식 AG-UI 클라이언트(HttpAgent)를 우리 서버 핸들러에 직접 연결한다. */
function client(handler: (req: Request, deps: LinerDeps) => Promise<Response>, deps: () => LinerDeps, initialState: object) {
  const events: any[] = [];
  const requests: any[] = [];
  const agent = new HttpAgent({ url: "http://test.local/api/agent", threadId: "thread-1", initialState });
  agent.fetch = (async (url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return handler(new Request(String(url), { method: "POST", headers: init.headers, body: init.body }), deps());
  }) as any;
  const run = (tools: object[] = [askTool]) => agent.runAgent({ tools: tools as any }, { onEvent: ({ event }) => void events.push(event) });
  return { agent, events, requests, run };
}

describe("AG-UI 지출 에이전트: 공식 클라이언트로 왕복", () => {
  it("이벤트 순서와 형식이 규격에 맞고, 질문은 프런트엔드 도구 호출로 남긴 채 run을 끝낸다", async () => {
    const f1 = fake([
      () => turn(["update_record", { date: "2026-11-18", amount: "26,400원", merchant: "○○마트", item: "행사 다과", paymentMethod: "personal" }], ["lookup_history", {}]),
      () => turn(["update_record", { project: "자원봉사자 워크숍" }], ["check_bundle", {}]),
      () => turn(["ask_user", { questions: [{ field: "purpose", text: "무엇을 위해 사셨나요?" }, { field: "project", text: "어느 행사인가요?" }, { field: "reimbursement", text: "환급이 필요한가요?" }] }]),
    ]);
    let current = f1;
    const c = client(handleExpenseRun, () => current.deps, { record: {}, locked: [], evidence: receipt, history });
    c.agent.addMessage({ id: "u1", role: "user", content: [{ type: "text", text: "간식 샀어요 1234-5678-9012-3456" }, { type: "image", source: { type: "data", value: "/9j/AAAA", mimeType: "image/jpeg" } }] } as any);
    await c.run();

    // 1) 이벤트: 모두 공식 스키마를 통과하고, RUN_STARTED로 시작해 RUN_FINISHED로 끝난다
    for (const e of c.events) expect(EventSchemas.safeParse(e).success, `${e.type} 형식`).toBe(true);
    const types = c.events.map((e) => e.type);
    expect(types[0]).toBe("RUN_STARTED");
    expect(c.events[0].protocolVersion).toBe("1.0");
    expect(types[1]).toBe("STATE_SNAPSHOT");
    expect(types.at(-1)).toBe("RUN_FINISHED");
    expect(types.filter((t) => t === "TOOL_CALL_START")).toHaveLength(5);
    expect(types.filter((t) => t === "TOOL_CALL_END")).toHaveLength(5);
    // 2) 백엔드 도구 4개는 결과가 있고, ask_user(프런트엔드 도구)는 서버가 답하지 않는다
    expect(types.filter((t) => t === "TOOL_CALL_RESULT")).toHaveLength(4);
    const ask = c.events.find((e) => e.type === "TOOL_CALL_START" && e.toolCallName === "ask_user");
    expect(c.events.some((e) => e.type === "TOOL_CALL_RESULT" && e.toolCallId === ask.toolCallId)).toBe(false);
    expect(c.events.at(-1).outcome).toEqual({ type: "success", pendingToolCallIds: [ask.toolCallId] });
    // 3) 이미 채운 사업은 묻지 않는다
    const askArgs = JSON.parse(c.events.find((e) => e.type === "TOOL_CALL_ARGS" && e.toolCallId === ask.toolCallId).delta);
    expect(askArgs.questions.map((q: any) => q.field)).toEqual(["purpose", "reimbursement"]);
    // 4) 상태: STATE_DELTA(JSON Patch)가 클라이언트 상태에 반영된다
    const st: any = c.agent.state;
    expect(st.record).toMatchObject({ date: "2026-11-18", amount: 26400, item: "행사 다과", paymentMethod: "personal", project: "자원봉사자 워크숍" });
    expect(st.aiFields).toEqual(expect.arrayContaining(["date", "amount", "project"]));
    expect(st.asks).toBe(1);
    // 5) 진행 단계는 ACTIVITY_SNAPSHOT으로 온다
    const acts = c.events.filter((e) => e.type === "ACTIVITY_SNAPSHOT").map((e) => e.content.tool);
    expect(acts).toEqual(["update_record", "lookup_history", "update_record", "check_bundle", "ask_user"]);
    // 6) 모델에 간 요청: 이미지 파트 변환, 메모 가림, 도구 목록에 승인·송금 없음
    const first = f1.modelCalls()[0];
    expect(first.headers.Authorization).toBe("Bearer test-key");
    const user = first.body.messages[1].content;
    expect(user.find((p: any) => p.type === "image_url").image_url.url).toBe("data:image/jpeg;base64,/9j/AAAA");
    expect(user[0].text).toContain("[카드번호 가림]");
    expect(user[0].text).not.toContain("1234-5678-9012-3456");
    const toolNames = first.body.tools.map((t: any) => t.function.name);
    expect(toolNames).toEqual(["update_record", "lookup_history", "check_bundle", "ask_user", "search_guidelines", "finish"]);
    expect(toolNames.join()).not.toMatch(/approve|confirm|pay|send/);
    expect(JSON.parse(f1.modelCalls()[1].body.messages.find((m: any) => m.role === "tool" && m.content.includes("projects")).content).projects).toEqual([{ name: "자원봉사자 워크숍", count: 2 }]);

    // ---- 사용자가 답한다: 다음 run의 messages에 tool 메시지로 실어 보낸다 ----
    const f2 = fake(
      [
        () => turn(["check_bundle", {}], ["search_guidelines", { query: "행사 다과 정산" }]),
        () => turn(["search_guidelines", { query: "비영리 지원사업 개인카드 선결제 환급 증빙 지침" }]),
        () => turn(["finish", { summary: "자원봉사자 워크숍 다과 구매. 김○○ 개인 카드 선결제, 환급 요청. 규정 위반은 아닙니다.", checklist: [
          { text: "환급 이체 확인증을 함께 보관하세요.", sourceUrl: "https://example.go.kr/a" },
          { text: "지어낸 항목", sourceUrl: "https://made-up.example/x" },
        ] }]),
      ],
      [[], guide],
    );
    current = f2;
    const answers = { purpose: "워크숍 다과 구매", payer: "김○○", reimbursement: "needed" };
    c.agent.setState({ ...st, record: { ...st.record, ...answers }, locked: Object.keys(answers) });
    c.agent.addMessage({ id: "t1", role: "tool", toolCallId: ask.toolCallId, content: JSON.stringify({ answers }) } as any);
    c.events.length = 0;
    await c.run();

    for (const e of c.events) expect(EventSchemas.safeParse(e).success, `${e.type} 형식`).toBe(true);
    const fin = c.events.at(-1);
    expect(fin.type).toBe("RUN_FINISHED");
    expect(fin.outcome).toBeUndefined();
    expect(fin.result).toMatchObject({ status: "done" });
    const s2: any = c.agent.state;
    expect(s2.record).toMatchObject({ ...answers, amount: 26400 });
    expect(s2.aiFields).not.toContain("purpose");
    // 검색 결과가 부실하면 검색어를 바꿔 다시 찾는다
    expect(f2.searchCalls().map((x) => x.body.query)).toEqual(["행사 다과 정산", "비영리 지원사업 개인카드 선결제 환급 증빙 지침"]);
    expect(f2.searchCalls()[0].headers["x-api-key"]).toBe("test-key");
    // 출처 없는 항목은 버리고 판정 표현은 거른다
    expect(s2.checklist).toEqual([{ text: "환급 이체 확인증을 함께 보관하세요.", sourceUrl: "https://example.go.kr/a" }]);
    expect(s2.summary).not.toMatch(/위반|부적법/);
    expect(s2.sources.map((x: any) => x.url)).toEqual(["https://example.go.kr/a", "https://example.org/b"]);
    expect(c.events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("")).toBe(s2.summary);
    // 두 번째 요청: 이전 대화 전체와 사용자의 답이 messages에 실려 가고, 모델에는 ask_user 호출 바로 뒤에 붙는다
    const sent = c.requests[1].messages;
    expect(sent.find((m: any) => m.role === "tool" && m.toolCallId === ask.toolCallId).content).toContain("워크숍 다과 구매");
    expect(sent.some((m: any) => m.role === "activity")).toBe(false);
    const resumed = f2.modelCalls()[0].body.messages;
    const idx = resumed.findIndex((m: any) => m.role === "assistant" && m.tool_calls?.some((t: any) => t.id === ask.toolCallId));
    expect(resumed[idx + 1]).toMatchObject({ role: "tool", tool_call_id: ask.toolCallId });
    expect(resumed[idx + 1].content).toContain("needed");
    expect(resumed.filter((m: any) => m.role === "tool")).toHaveLength(5);
  });

  it("Liner 오류는 스트림 안의 RUN_ERROR로 온다", async () => {
    const f = fake([() => jsonRes({ error: { code: "insufficient_quota" } }, 402)]);
    const c = client(handleExpenseRun, () => f.deps, { record: {}, evidence: receipt });
    c.agent.addMessage({ id: "u1", role: "user", content: "간식" } as any);
    await c.run().catch(() => {});
    const types = c.events.map((e) => e.type);
    expect(types[0]).toBe("RUN_STARTED");
    expect(types.at(-1)).toBe("RUN_ERROR");
    expect(c.events.at(-1).message).toContain("크레딧");
  });

  it("실행 전 오류는 스트림 없이 HTTP 오류로 거절한다", async () => {
    const f = fake([]);
    const post = (body: unknown) => handleExpenseRun(new Request("http://test.local/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), f.deps);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ hello: 1 })).status).toBe(400);
    const badImage = { threadId: "t", runId: "r", messages: [{ id: "u", role: "user", content: [{ type: "image", source: { type: "data", value: "AAAA", mimeType: "image/gif" } }] }], tools: [], context: [], state: {} };
    expect((await post(badImage)).status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });

  it("다른 출처의 브라우저에서도 부를 수 있다 (CORS)", async () => {
    const pre = preflight();
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    const f = fake([() => turn(["finish", { summary: "끝", checklist: [] }])]);
    const body = { threadId: "t", runId: "r", messages: [{ id: "u", role: "user", content: "다과" }], tools: [], context: [{ description: "단체 이름", value: "다온 나눔모임" }], state: { record: { date: "2026-11-18", amount: 1000, item: "다과", project: "워크숍", paymentMethod: "cash" } } };
    const ok = await handleExpenseRun(new Request("http://test.local/x", { method: "POST", body: JSON.stringify(body) }), f.deps);
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    expect(ok.headers.get("content-type")).toBe("text/event-stream");
    await ok.text();
    // context로 보낸 참고 정보가 모델에 전달된다
    expect(f.modelCalls()[0].body.messages[1].content).toContain("단체 이름: 다온 나눔모임");
    const badReq = await handleExpenseRun(new Request("http://test.local/x", { method: "POST", body: "{" }), f.deps);
    expect(badReq.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("클라이언트가 ask_user 도구를 주지 않으면 묻지 않고 끝까지 진행한다", async () => {
    const f = fake([() => turn(["ask_user", { questions: [{ field: "purpose", text: "목적은요?" }] }]), () => turn(["finish", { summary: "끝", checklist: [] }])]);
    const c = client(handleExpenseRun, () => f.deps, { record: { date: "2026-11-18", amount: 1000, item: "다과", project: "워크숍", paymentMethod: "cash" }, evidence: receipt });
    c.agent.addMessage({ id: "u1", role: "user", content: "다과" } as any);
    await c.run([]);
    expect(c.events.at(-1).outcome).toBeUndefined();
    expect(c.events.filter((e) => e.type === "TOOL_CALL_RESULT")).toHaveLength(2);
    expect(f.modelCalls()[0].body.tools.map((t: any) => t.function.name)).not.toContain("ask_user");
    expect(f.modelCalls()[0].body.messages[0].content).toContain("물을 수 없습니다");
  });
});

describe("지출 에이전트 규칙", () => {
  const start = (text = "x") => [{ role: "user", content: text }];
  it("사람이 직접 넣은 값은 덮어쓰지 않는다", async () => {
    const fin = () => turn(["finish", { summary: "요약", checklist: [] }]);
    const f = fake([() => turn(["update_record", { amount: 99999, item: "간식" }]), fin, fin]);
    const out = await runExpenseAgent({ messages: start(), record: { amount: 26400 }, locked: ["amount"], evidence: receipt }, f.deps);
    expect(out.record.amount).toBe(26400);
    expect(out.record.item).toBe("간식");
    expect(out.aiFields).toEqual(["item"]);
    expect(JSON.parse(f.modelCalls()[1].body.messages.find((m: any) => m.role === "tool").content).skippedBecauseUserEntered).toEqual(["amount"]);
  });
  it("쓸 수 없는 값은 반영하지 않는다", async () => {
    const f = fake([() => turn(["update_record", { date: "11월 18일", paymentMethod: "bitcoin", reimbursement: "maybe", amount: -5 }]), () => turn(["finish", { summary: "", checklist: [] }]), () => turn(["finish", { summary: "", checklist: [] }])]);
    const out = await runExpenseAgent({ messages: start(), record: { item: "다과" }, evidence: receipt }, f.deps);
    expect(out.record).toEqual({ item: "다과" });
    expect(out.summary).toContain("다과");
  });
  it("질문은 두 번까지, 검색은 세 번까지만 허용한다", async () => {
    const ask = () => turn(["ask_user", { questions: [{ field: "purpose", text: "목적은요?" }] }]);
    const f = fake([ask, () => turn(...[1, 2, 3, 4].map((i) => ["search_guidelines", { query: `q${i}` }] as [string, object])), () => turn(["finish", { summary: "끝", checklist: [] }])]);
    const full = { date: "2026-11-18", amount: 1000, item: "다과", project: "워크숍", paymentMethod: "cash" };
    const out = await runExpenseAgent({ messages: start(), record: full, evidence: receipt, asks: 2 }, f.deps);
    expect(out.status).toBe("done");
    expect(out.searches).toBe(3);
    expect(f.searchCalls()).toHaveLength(3);
    expect(f.modelCalls()[1].body.messages.some((m: any) => m.role === "tool" && m.content.includes("더 물을 수 없습니다"))).toBe(true);
  });
  it("필수 정보가 빈 채로 끝내려 하면 한 번 돌려보낸다", async () => {
    const f = fake([
      () => turn(["finish", { summary: "시연용이라 기록하지 않았습니다.", checklist: [] }]),
      () => turn(["update_record", { date: "2026-11-18", amount: 26400, item: "행사 다과", paymentMethod: "personal", project: "워크숍" }]),
      () => turn(["finish", { summary: "워크숍 다과 구매.", checklist: [] }]),
    ]);
    const out = await runExpenseAgent({ messages: start(), record: {}, evidence: receipt }, f.deps);
    expect(out.record.amount).toBe(26400);
    expect(out.summary).toBe("워크숍 다과 구매.");
    expect(f.modelCalls()[1].body.messages.at(-1).content).toContain("필수 정보가 비어 있습니다");
    // 두 번째에도 비어 있으면 그대로 마친다 (끝없이 막지 않는다)
    const g = fake([() => turn(["finish", { summary: "a", checklist: [] }]), () => turn(["finish", { summary: "b", checklist: [] }])]);
    expect((await runExpenseAgent({ messages: start(), record: {}, evidence: receipt }, g.deps)).summary).toBe("b");
  });
  it("같은 점검을 되풀이하면 다음 단계로 가라고 알려 준다", async () => {
    const f = fake([() => turn(["check_bundle", {}]), () => turn(["check_bundle", {}]), () => turn(["finish", { summary: "끝", checklist: [] }]), () => turn(["finish", { summary: "끝", checklist: [] }])]);
    const steps: AgentStep[] = [];
    await runExpenseAgent({ messages: start(), record: { item: "다과" }, evidence: receipt }, f.deps, { onStep: (s) => void steps.push(s) });
    expect(steps.filter((s) => s.tool === "check_bundle")).toHaveLength(1);
    expect(f.modelCalls()[2].body.messages.at(-1).content).toContain("바뀌지 않았습니다");
  });
  it("끝없이 돌지 않는다: 턴 한도에 닿으면 지금까지의 내용으로 마무리", async () => {
    const f = fake(Array.from({ length: MAX_TURNS }, () => () => turn(["check_bundle", {}])));
    const out = await runExpenseAgent({ messages: start(), record: { item: "다과", project: "워크숍" }, evidence: receipt }, f.deps);
    expect(out.status).toBe("done");
    expect(f.modelCalls()).toHaveLength(MAX_TURNS);
    expect(out.summary).toContain("워크숍");
  });
  it("AG-UI 메시지 변환: 도구 결과를 호출 뒤에 붙이고, 답 없는 호출은 채운다", () => {
    const out = toModelMessages([
      { id: "u", role: "user", content: "hi" },
      { id: "a", role: "assistant", toolCalls: [{ id: "c1", type: "function", function: { name: "x", arguments: "{}" } }, { id: "c2", type: "function", function: { name: "y", arguments: "{}" } }] },
      { id: "act", role: "activity", activityType: "z", content: {} },
      { id: "t2", role: "tool", toolCallId: "c2", content: "두 번째" },
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool"]);
    expect(out[2]).toMatchObject({ tool_call_id: "c1" });
    expect(out[2].content).toContain("응답이 없었습니다");
    expect(out[3]).toEqual({ role: "tool", tool_call_id: "c2", content: "두 번째" });
  });
});

describe("AG-UI 마감 점검 에이전트", () => {
  const records = () => [...seedExpenses(), demoSnackExpense()];
  const script = () => [
    () => turn(["list_records", {}]),
    () => turn(["inspect_record", { id: "seed-transport" }], ["inspect_record", { id: "demo-snack" }]),
    () => turn(
      ["draft_request", { id: "seed-transport", message: "교통비 12,500원 건의 이체확인증을 이번 주 금요일까지 첨부해 주세요." }],
      ["draft_request", { id: "demo-snack", to: "박○○", message: "행사 다과 26,400원 건의 환급 여부를 확인하고 승인 부탁드립니다." }],
      ["draft_request", { id: "seed-print", message: "완료된 건" }],
      ["draft_request", { id: "nope", message: "없는 건" }],
    ),
    () => turn(["finish", { briefing: "총 3건 56,900원입니다. 2건에 확인이 남았습니다. 교통비는 규정 위반입니다." }]),
  ];
  it("기록을 훑고, 보완이 필요한 건에만 요청 초안을 쓰고, 브리핑을 넘긴다", async () => {
    const steps: AgentStep[] = [];
    const f = fake(script());
    const out = await runCloseAgent({ project: "자원봉사자 워크숍", records: records() }, f.deps, { onStep: (s) => void steps.push(s) });
    expect(out.requests.map((r) => r.id)).toEqual(["seed-transport", "demo-snack"]);
    expect(out.requests[0]).toMatchObject({ item: "교통비", amount: 12500, to: "김○○" });
    expect(out.requests[1].to).toBe("박○○");
    expect(out.briefing).toContain("56,900원");
    expect(out.briefing).not.toMatch(/위반/);
    expect(f.modelCalls()[0].body.tools.map((t: any) => t.function.name)).toEqual(["list_records", "inspect_record", "search_guidelines", "draft_request", "finish"]);
    const listed = JSON.parse(f.modelCalls()[1].body.messages.find((m: any) => m.role === "tool").content);
    expect(listed.total).toBe(56900);
    expect(steps.at(-1)).toMatchObject({ tool: "finish", detail: "요청 초안 2건" });
  });
  it("공식 클라이언트로 왕복: 브리핑과 요청 초안이 상태로 전달된다", async () => {
    const f = fake(script());
    const c = client(handleCloseRun, () => f.deps, { project: "자원봉사자 워크숍", records: records() });
    c.agent.addMessage({ id: "u1", role: "user", content: "정산 마감 전 점검을 해 주세요." } as any);
    await c.run([]);
    for (const e of c.events) expect(EventSchemas.safeParse(e).success, `${e.type} 형식`).toBe(true);
    expect(c.events.at(-1).type).toBe("RUN_FINISHED");
    const st: any = c.agent.state;
    expect(st.requests.map((r: any) => r.id)).toEqual(["seed-transport", "demo-snack"]);
    expect(st.briefing).toContain("56,900원");
  });
});
