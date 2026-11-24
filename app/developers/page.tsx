// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 개발자 안내 (/developers). 다른 서비스에서 이 에이전트를 AG-UI로 부르는 방법과 예제,
 * 그리고 브라우저에서 바로 실행해 이벤트를 확인하는 실행기.
 */
"use client";

import { HttpAgent } from "@ag-ui/client";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useState } from "react";

const P = ({ children }: { children: React.ReactNode }) => <Text display="block">{children}</Text>;
const Note = ({ children }: { children: React.ReactNode }) => <Text type="supporting" color="secondary" display="block">{children}</Text>;

const quickStart = (base: string) => `import { HttpAgent } from "@ag-ui/client";

// 1. 에이전트에 연결한다
const agent = new HttpAgent({ url: "${base}/api/agent/expense" });

// 2. 상태(기록)와 사용자 메시지를 넣는다
agent.setState({ record: {}, evidence: { kind: "none" }, history: [] });
agent.addMessage({
  id: crypto.randomUUID(),
  role: "user",
  content: "11월 18일 워크숍 다과 26,400원 개인 카드로 결제",
});

// 3. 실행한다. 이벤트가 오는 대로 콜백이 불린다
await agent.runAgent(
  { tools: [], context: [{ description: "단체 이름", value: "다온 나눔모임" }] },
  {
    onActivitySnapshotEvent: ({ event }) => console.log("진행:", event.content.label),
    onRunErrorEvent: ({ event }) => console.error(event.message),
  },
);

// 4. 결과는 상태에 들어 있다
console.log(agent.state.record);    // { amount: 26400, item: "워크숍 다과", ... }
console.log(agent.state.summary);   // 두 문장 요약
console.log(agent.state.checklist); // [{ text, sourceUrl }]`;

const withImage = `// 영수증 사진은 user 메시지의 image 파트로 보낸다 (base64, PNG·JPEG·WEBP, 5MB 이하)
agent.addMessage({
  id: crypto.randomUUID(),
  role: "user",
  content: [
    { type: "text", text: "간식 샀어요" },
    { type: "image", source: { type: "data", mimeType: "image/jpeg", value: base64 } },
  ],
});
agent.setState({ record: {}, evidence: { kind: "receipt", hasImage: true }, history: [] });`;

const askUser = `// 1. 질문 도구를 선언해서 보낸다. 선언하지 않으면 에이전트는 묻지 않고 끝까지 진행한다
const ASK_USER = {
  name: "ask_user",
  description: "에이전트가 스스로 알 수 없는 정보를 사용자에게 묻는다",
  parameters: { type: "object", properties: { questions: { type: "array" } }, required: ["questions"] },
};
let pending = [];
await agent.runAgent({ tools: [ASK_USER] }, {
  onRunFinishedEvent: (p) => { if (p.outcome === "success") pending = p.pendingToolCallIds; },
});

// 2. 답을 기다리는 호출이 있으면 질문을 꺼내 화면에 보여 준다
const calls = agent.messages.flatMap((m) => (m.role === "assistant" ? m.toolCalls ?? [] : []));
const { questions } = JSON.parse(calls.find((c) => c.id === pending[0]).function.arguments);
// questions: [{ field: "purpose", text: "무엇을 위해 사셨나요?" }, ...]

// 3. 답을 tool 메시지로 붙이고, 상태에도 반영한 뒤 다시 실행한다
const answers = { purpose: "워크숍 다과 구매", payer: "김다온", reimbursement: "needed" };
agent.setState({ ...agent.state, record: { ...agent.state.record, ...answers }, locked: Object.keys(answers) });
agent.addMessage({ id: crypto.randomUUID(), role: "tool", toolCallId: pending[0], content: JSON.stringify({ answers }) });
await agent.runAgent({ tools: [ASK_USER] });`;

const curl = (base: string) => `curl -N ${base}/api/agent/expense \\
  -H "Content-Type: application/json" -H "Accept: text/event-stream" \\
  -d '{"threadId":"t1","runId":"r1","tools":[],"context":[],
       "messages":[{"id":"u1","role":"user","content":"11월 18일 워크숍 다과 26,400원 개인 카드로 결제"}],
       "state":{"record":{},"evidence":{"kind":"none"}}}'`;

const closeAgent = (base: string) => `const agent = new HttpAgent({
  url: "${base}/api/agent/close",
  initialState: { project: "자원봉사자 워크숍", records }, // records: 지출 기록 배열
});
agent.addMessage({ id: crypto.randomUUID(), role: "user", content: "정산 마감 전 점검을 해 주세요." });
await agent.runAgent({ tools: [] });
console.log(agent.state.briefing);  // 대표에게 줄 브리핑
console.log(agent.state.requests);  // [{ id, item, amount, to, message }] 보완 요청 문안 초안`;

const events: { type: string; when: string }[] = [
  { type: "RUN_STARTED", when: "실행 시작. protocolVersion \"1.0\"" },
  { type: "STATE_SNAPSHOT", when: "기준 상태. 보낸 state를 정리한 것" },
  { type: "TOOL_CALL_START / ARGS / END", when: "에이전트가 고른 도구와 인자" },
  { type: "TOOL_CALL_RESULT", when: "서버가 실행한 도구의 결과. ask_user에는 오지 않는다" },
  { type: "ACTIVITY_SNAPSHOT", when: "사람이 읽을 진행 단계. content: { tool, label, detail }" },
  { type: "STATE_DELTA", when: "기록 변경 (JSON Patch). 공식 클라이언트가 state에 자동 반영" },
  { type: "TEXT_MESSAGE_START / CONTENT / END", when: "요약 또는 브리핑 문장" },
  { type: "RUN_FINISHED", when: "정상 종료. 답을 기다리는 호출이 있으면 outcome.pendingToolCallIds" },
  { type: "RUN_ERROR", when: "실행 중 오류. message는 사용자에게 보여 줄 수 있는 한국어 문장" },
];
const stateRows: { key: string; who: string; desc: string }[] = [
  { key: "record", who: "양쪽", desc: "지출 기록. date(YYYY-MM-DD), amount(원), merchant, item, paymentMethod(org_card·transfer·personal·cash), purpose, project, budgetCategory, payer, reimbursement(needed·not_needed)" },
  { key: "locked", who: "클라이언트", desc: "사람이 직접 넣은 필드 이름 목록. 에이전트가 덮어쓰지 못한다" },
  { key: "evidence", who: "클라이언트", desc: "{ kind: receipt·alternative·none, hasImage, hasReason }" },
  { key: "history", who: "클라이언트", desc: "지난 기록 요약 [{ project, item, budgetCategory, paymentMethod, amount, date }]. 사업명·예산 항목 추정에 쓴다" },
  { key: "aiFields", who: "에이전트", desc: "에이전트가 채운 필드 이름 목록" },
  { key: "summary, checklist, sources", who: "에이전트", desc: "요약, 확인할 자료 [{ text, sourceUrl }], 검색 출처 목록" },
  { key: "searches, asks", who: "에이전트", desc: "검색·질문 횟수. 다음 실행에 그대로 돌려보내야 한도가 유지된다" },
];

export default function DevelopersPage() {
  const [base, setBase] = useState("https://open-receipt-six.vercel.app");
  const [memo, setMemo] = useState("11월 18일 워크숍 다과 26,400원 개인 카드로 결제");
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => setBase(window.location.origin), []);

  async function tryIt() {
    setBusy(true); setLog([]); setResult(""); setErr("");
    const agent = new HttpAgent({ url: "/api/agent/expense", initialState: { record: {}, evidence: { kind: "none" }, history: [] } });
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: memo } as any);
    let failure = "";
    try {
      await agent.runAgent({ tools: [] }, {
        onEvent: ({ event }) => {
          const e = event as any;
          const extra = e.type === "ACTIVITY_SNAPSHOT" ? ` · ${e.content?.label}` : e.type === "TOOL_CALL_START" ? ` · ${e.toolCallName}` : e.type === "TEXT_MESSAGE_CONTENT" ? ` · ${String(e.delta).slice(0, 60)}` : "";
          setLog((l) => [...l, `${e.type}${extra}`]);
        },
        onRunErrorEvent: ({ event }) => { failure = event.message; },
      });
    } catch { if (!failure) failure = "에이전트를 실행하지 못했습니다."; }
    if (failure) setErr(failure);
    else {
      const st = agent.state as any;
      setResult(JSON.stringify({ record: st.record, summary: st.summary, checklist: st.checklist }, null, 2));
    }
    setBusy(false);
  }

  return (
    <VStack as="main" className="app" gap={0} maxWidth={900}>
      <HStack as="header" className="app-bar" justify="between" align="center" paddingInline={4} paddingBlock={3} gap={2}>
        <Heading level={1}>개발자 안내</Heading>
        <Button label="열린영수증 열기" size="sm" href="/app" />
      </HStack>
      <VStack gap={4} padding={4}>
        <VStack gap={2}>
          <Heading level={2}>열린영수증 에이전트를 내 서비스에서 부르기</Heading>
          <P>열린영수증의 두 에이전트는 AG-UI 프로토콜 1.0으로 열려 있습니다. AG-UI를 지원하는 클라이언트라면 이 웹앱과 똑같은 방식으로 에이전트를 부를 수 있습니다. 다른 웹앱, 사내 도구, 메신저 봇의 서버에서 영수증 정리와 마감 점검을 그대로 쓸 수 있습니다.</P>
          <Note>이 웹앱의 화면도 아래 예제와 같은 공식 클라이언트(@ag-ui/client의 HttpAgent)로 에이전트를 부릅니다.</Note>
        </VStack>

        <Heading level={2}>1. 엔드포인트</Heading>
        <VStack className="scroll-x wide-table">
          <Table
            idKey="url"
            data={[
              { url: `${base}/api/agent/expense`, agent: "지출 에이전트", does: "영수증·메모에서 기록을 채우고, 모르는 것은 묻고, 공개 지침을 찾아 증빙 묶음을 완성" },
              { url: `${base}/api/agent/close`, agent: "마감 점검 에이전트", does: "기록 전체를 훑어 브리핑과 건별 보완 요청 문안 초안 작성" },
            ]}
            columns={[{ key: "agent", header: "에이전트" }, { key: "url", header: "주소 (POST)", renderCell: (x) => <Text type="code">{x.url}</Text> }, { key: "does", header: "하는 일" }]}
          />
        </VStack>
        <Note>요청 본문은 AG-UI의 RunAgentInput(JSON)이고 응답은 text/event-stream입니다. 필수 필드는 threadId, runId, messages이며 공식 클라이언트가 자동으로 채웁니다. 다른 출처의 브라우저에서도 부를 수 있도록 CORS를 열어 두었습니다.</Note>

        <Heading level={2}>2. 빠른 시작</Heading>
        <CodeBlock language="bash" code="npm install @ag-ui/client" />
        <CodeBlock language="typescript" title="지출 에이전트 부르기" code={quickStart(base)} />
        <CodeBlock language="typescript" title="영수증 사진 보내기" code={withImage} />

        <Heading level={2}>3. 상태(state) 구조</Heading>
        <P>에이전트와 화면은 state를 함께 봅니다. 서버는 실행 사이에 아무것도 저장하지 않으므로, 이어서 실행할 때는 직전 실행의 state와 messages를 그대로 다시 보내야 합니다. 공식 클라이언트는 이를 자동으로 합니다.</P>
        <VStack className="scroll-x wide-table">
          <Table idKey="key" verticalAlign="top" data={stateRows}
            columns={[{ key: "key", header: "필드", renderCell: (x) => <Text type="code">{x.key}</Text> }, { key: "who", header: "쓰는 쪽" }, { key: "desc", header: "내용" }]} />
        </VStack>
        <Note>단체 이름, 지원기관처럼 검색에 참고할 정보는 context 배열 [{"{"} description, value {"}"}]로 보냅니다.</Note>

        <Heading level={2}>4. 사용자에게 묻기 (프런트엔드 도구)</Heading>
        <P>에이전트가 목적이나 환급 여부처럼 스스로 알 수 없는 것을 물을 때는 AG-UI의 프런트엔드 도구 방식을 씁니다. 화면이 ask_user 도구를 선언해 보내면, 에이전트는 그 도구를 호출한 채 실행을 끝내고, 화면이 답을 tool 메시지로 붙여 다시 실행합니다.</P>
        <CodeBlock language="typescript" title="질문 받고 답하기" code={askUser} />

        <Heading level={2}>5. 마감 점검 에이전트</Heading>
        <CodeBlock language="typescript" code={closeAgent(base)} />

        <Heading level={2}>6. 이벤트</Heading>
        <Table idKey="type" verticalAlign="top" data={events}
          columns={[{ key: "type", header: "이벤트", renderCell: (x) => <Text type="code">{x.type}</Text> }, { key: "when", header: "언제, 무엇을" }]} />
        <Note>실행 전 오류(형식 오류, 허용되지 않는 이미지)는 스트림 없이 HTTP 400으로 돌아옵니다.</Note>

        <Heading level={2}>7. 클라이언트 없이 직접 호출</Heading>
        <CodeBlock language="bash" code={curl(base)} />

        <Heading level={2}>8. 직접 해 보기</Heading>
        <Card>
          <VStack gap={3}>
            <Note>아래 문장을 지출 에이전트에 보내고, 돌아오는 이벤트와 결과 상태를 그대로 보여 줍니다. 질문 도구 없이 실행하므로 에이전트는 묻지 않고 끝까지 진행합니다.</Note>
            <TextArea id="try-memo" label="사용자 메시지" value={memo} onChange={setMemo} />
            <Button label={busy ? "실행하는 중…" : "실행"} variant="primary" isDisabled={busy || !memo.trim()} onClick={tryIt} />
            {err ? <Banner status="error" title={err} /> : null}
            {log.length ? <CodeBlock language="plaintext" title="받은 이벤트" code={log.join("\n")} maxHeight={280} hasCopyButton={false} /> : null}
            {result ? <CodeBlock language="json" title="실행 후 agent.state" code={result} maxHeight={320} /> : null}
          </VStack>
        </Card>

        <Heading level={2}>9. 한도와 주의할 점</Heading>
        <Table idKey="k" verticalAlign="top"
          data={[
            { k: "한 번 실행의 한도", v: "모델 호출 10회, 검색 3회, 질문 2회, 최대 120초" },
            { k: "이미지", v: "PNG·JPEG·WEBP, 장당 5MB 이하, base64 데이터로 전송. 개인정보는 보내기 전에 가려 주세요" },
            { k: "에이전트가 하지 않는 일", v: "승인, 환급 결정, 메시지 발송, 적법 여부 판정. 그런 도구가 없습니다" },
            { k: "인증", v: "현재 인증이 없는 시연용 공개 엔드포인트입니다. 호출마다 운영자의 Liner 크레딧이 쓰이므로 실서비스에 붙이려면 저장소를 받아 자신의 키로 직접 배포하세요" },
            { k: "호출 제한", v: "한 주소에서 10분에 80번, 하루 400번까지. 넘으면 429와 Retry-After 헤더로 응답합니다. 전체 호출이 하루 한도를 넘어도 429입니다" },
            { k: "프로토콜 버전", v: "AG-UI 1.0. 공식 @ag-ui/client 1.0.x로 왕복 테스트했습니다" },
          ]}
          columns={[{ key: "k", header: "항목" }, { key: "v", header: "내용" }]} />

        <Heading level={2}>10. 더 알아보기</Heading>
        <HStack gap={2} wrap="wrap">
          <Button label="AG-UI 프로토콜 문서" href="https://docs.ag-ui.com/" target="_blank" rel="noreferrer" />
          <Button label="HttpAgent 문서" href="https://docs.ag-ui.com/sdk/js/client/http-agent" target="_blank" rel="noreferrer" />
          <Button label="Liner 개발자 문서" href="https://liner.com/ko/developers/docs" target="_blank" rel="noreferrer" />
        </HStack>
      </VStack>
    </VStack>
  );
}
