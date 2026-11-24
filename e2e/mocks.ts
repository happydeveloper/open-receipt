// SPDX-License-Identifier: GPL-3.0-or-later
// 브라우저 테스트와 화면 캡처가 함께 쓰는 가짜 에이전트 응답.
// AG-UI 이벤트 스트림(SSE)을 흉내 낸다.
export const sseBody = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
export const started = { type: "RUN_STARTED", threadId: "t1", runId: "r1", protocolVersion: "1.0" };
export const finished = (extra: object = {}) => ({ type: "RUN_FINISHED", threadId: "t1", runId: "r1", ...extra });
export let actSeq = 0;
export const act = (tool: string, label: string, detail = "") => ({ type: "ACTIVITY_SNAPSHOT", messageId: `act-${++actSeq}`, activityType: "open-receipt.step", content: { tool, label, detail } });
export const base = { date: "2026-11-18", amount: 26400, merchant: "○○마트 워크숍점", item: "행사 다과", paymentMethod: "personal", project: "자원봉사자 워크숍", budgetCategory: "회의·행사비" };
export const agentState = { locked: [], evidence: { kind: "receipt", hasImage: true, hasReason: false }, history: [], sources: [], searches: 0, asks: 1, summary: "", checklist: [] };
export const askQuestions = [{ field: "purpose", text: "무엇을 위해 사셨나요?" }, { field: "reimbursement", text: "누가 결제했고, 환급이 필요한가요?" }];
export const askTurn = sseBody(
  started,
  act("update_record", "기록을 채웠습니다", "일자, 금액, 가맹점, 항목, 결제 방식"),
  act("lookup_history", "지난 기록을 확인했습니다", "2건"),
  act("update_record", "기록을 채웠습니다", "사업·행사, 예산 항목"),
  act("check_bundle", "증빙 묶음을 점검했습니다: 빠진 항목 3개", "목적, 결제자, 환급 여부"),
  { type: "TOOL_CALL_START", toolCallId: "call_ask", toolCallName: "ask_user", parentMessageId: "msg-1" },
  { type: "TOOL_CALL_ARGS", toolCallId: "call_ask", delta: JSON.stringify({ questions: askQuestions }) },
  { type: "TOOL_CALL_END", toolCallId: "call_ask" },
  act("ask_user", "알 수 없는 2가지를 여쭙니다", "목적, 환급 여부"),
  { type: "STATE_SNAPSHOT", snapshot: { ...agentState, record: base, aiFields: Object.keys(base) } },
  finished({ outcome: { type: "success", pendingToolCallIds: ["call_ask"] } }),
);
export const sources = [
  { title: "지원사업 회계 처리 안내", url: "https://example.go.kr/guide", hostname: "example.go.kr", date: "2026-04-15", description: "" },
  { title: "소규모 단체 회계 실무", url: "https://example.org/practice", hostname: "example.org", date: null, description: "" },
];
export const summary = "자원봉사자 워크숍 다과 구매. 김○○ 개인 카드 선결제, 환급 요청.";
export const checklist = [
  { text: "개인 카드 선결제는 환급 이체 확인증을 함께 보관하세요.", sourceUrl: "https://example.go.kr/guide" },
  { text: "다과비는 행사 개요나 참석 인원 기록을 함께 두세요.", sourceUrl: "https://example.org/practice" },
];
export const doneTurn = sseBody(
  started,
  act("ask_user", "답변을 받았습니다"),
  act("search_guidelines", "공개 지침을 검색했습니다 (0건)", "행사 다과 정산"),
  act("search_guidelines", "공개 지침을 검색했습니다 (2건)", "비영리 지원사업 개인카드 선결제 환급 증빙 지침"),
  act("finish", "정리를 마쳤습니다", "확인할 자료 2건"),
  { type: "STATE_SNAPSHOT", snapshot: { ...agentState, record: { ...base, purpose: "워크숍 다과 구매", payer: "김○○", reimbursement: "needed" }, aiFields: Object.keys(base), locked: ["purpose", "payer", "reimbursement"], sources, searches: 2, summary, checklist } },
  { type: "TEXT_MESSAGE_START", messageId: "sum-1", role: "assistant" },
  { type: "TEXT_MESSAGE_CONTENT", messageId: "sum-1", delta: summary },
  { type: "TEXT_MESSAGE_END", messageId: "sum-1" },
  finished({ result: { status: "done" } }),
);
export const closeTurn = sseBody(
  started,
  act("list_records", "기록 3건을 훑었습니다", "합계 56,900원"),
  act("inspect_record", "교통비 건을 살펴봤습니다", "이체확인증 또는 대체 증빙 첨부"),
  act("draft_request", "교통비 보완 요청 초안을 썼습니다", "받는 사람: 김○○"),
  act("finish", "마감 점검을 마쳤습니다", "요청 초안 1건"),
  { type: "STATE_SNAPSHOT", snapshot: { project: "자원봉사자 워크숍", records: [], briefing: "총 3건 56,900원입니다. 교통비 1건에 증빙 보완이 남았습니다.", requests: [{ id: "seed-transport", item: "교통비", amount: 12500, to: "김○○", message: "교통비 12,500원 건의 이체확인증을 금요일까지 첨부해 주세요." }] } },
  finished(),
);
export const ndjson = { status: 200, contentType: "text/event-stream" };

