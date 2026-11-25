// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * AG-UI 프로토콜(1.0) 서버 어댑터.
 * 요청은 RunAgentInput(JSON), 응답은 SSE 이벤트 스트림이다.
 *   RUN_STARTED → STATE_SNAPSHOT → (TOOL_CALL_START/ARGS/END → TOOL_CALL_RESULT, ACTIVITY_SNAPSHOT, STATE_DELTA)* → RUN_FINISHED | RUN_ERROR
 * 사용자에게 묻는 일은 클라이언트가 제공한 프런트엔드 도구(ask_user) 호출로 표현한다.
 * 서버는 그 호출에 답하지 않고 run을 끝내며, 답은 다음 run의 messages에 tool 메시지로 온다.
 * 서버는 상태를 보관하지 않는다. 필요한 것은 모두 state와 messages에 실려 온다.
 */
import { EventType } from "@ag-ui/core";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { EventEncoder } from "@ag-ui/encoder";
import { expenseKickoffText, normalizeRecord, runCloseAgent, runExpenseAgent, runGroupAgent, type AgentStep, type LoopHooks, type RecordValues } from "./agent";
import { toSources } from "./guidelines";
import { defaultDeps, LinerError, type LinerDeps } from "./liner";
import type { Expense } from "./types";

export const PROTOCOL_VERSION = "1.0";
export const ASK_USER_TOOL = "ask_user";
export const ACTIVITY_TYPE = "open-receipt.step";
const MAX_IMAGE_CHARS = 6_500_000; // 약 5MB 이미지의 base64 길이
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

type Emit = (event: Record<string, unknown>) => void;
type Finish = { result?: unknown; pendingToolCallIds?: string[] };

/** 다른 사이트의 프런트엔드(AG-UI 클라이언트)에서도 부를 수 있게 한다. 쿠키나 인증 정보는 쓰지 않는다. */
export const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Accept", "Access-Control-Max-Age": "86400" };
export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** 실행을 시작하기 전에 걸러 내는 잘못된 요청. HTTP 400으로 답한다. */
class BadInput extends Error {}
const bad = (message: string, status = 400) => new Response(JSON.stringify({ error: message }), { status, headers: { "Content-Type": "application/json", ...CORS } });

/** 요청 본문을 AG-UI 공식 스키마로 검증한다. */
async function readInput(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadInput("요청 본문이 JSON이 아닙니다.");
  }
  const parsed = RunAgentInputSchema.safeParse(body);
  if (!parsed.success) throw new BadInput("AG-UI RunAgentInput 형식이 아닙니다 (threadId, runId, messages 필요).");
  return parsed.data;
}

/** 실행 전 오류는 HTTP 오류로, 실행 중 오류는 스트림 안의 RUN_ERROR로 알린다. */
function sse(input: { threadId: string; runId: string }, body: (emit: Emit) => Promise<Finish>, tag: string): Response {
  const encoder = new EventEncoder();
  const text = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit: Emit = (event) => controller.enqueue(text.encode(encoder.encode(event as any)));
      emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId, protocolVersion: PROTOCOL_VERSION });
      try {
        const fin = await body(emit);
        emit({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
          ...(fin.result !== undefined ? { result: fin.result } : {}),
          ...(fin.pendingToolCallIds?.length ? { outcome: { type: "success", pendingToolCallIds: fin.pendingToolCallIds } } : {}),
        });
      } catch (err) {
        if (err instanceof LinerError) {
          // 로그에는 상태와 코드만 남긴다. 요청 내용이나 키가 로그에 들어가지 않게 한다.
          console.error(`[${tag}] liner error`, err.status, err.code);
          emit({ type: EventType.RUN_ERROR, message: err.userMessage, code: err.code });
        } else {
          console.error(`[${tag}] unexpected error`);
          emit({ type: EventType.RUN_ERROR, message: "에이전트가 작업을 마치지 못했습니다. 직접 입력으로 계속할 수 있습니다.", code: "internal" });
        }
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", ...CORS } });
}

/** 도구 호출·결과·진행 단계를 AG-UI 이벤트로 내보내는 훅. */
function eventHooks(emit: Emit): LoopHooks {
  return {
    onCall(c) {
      emit({ type: EventType.TOOL_CALL_START, toolCallId: c.id, toolCallName: c.name, parentMessageId: c.parentId });
      emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: c.id, delta: JSON.stringify(c.args ?? {}) });
      emit({ type: EventType.TOOL_CALL_END, toolCallId: c.id });
    },
    onResult(c) {
      emit({ type: EventType.TOOL_CALL_RESULT, messageId: `res-${c.id}`, toolCallId: c.id, content: c.content, role: "tool" });
    },
    onStep(s: AgentStep, callId?: string) {
      emit({ type: EventType.ACTIVITY_SNAPSHOT, messageId: `act-${callId ?? "final"}`, activityType: ACTIVITY_TYPE, content: { tool: s.tool, label: s.label, detail: s.detail ?? "" } });
    },
  };
}

/** AG-UI 메시지의 content(문자열 또는 파트 배열)에서 글만 뽑는다. */
const partText = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("\n") : "";

/** AG-UI 메시지를 모델 API(OpenAI 호환) 형식으로 바꾼다. 도구 결과는 그 호출 바로 뒤에 오도록 정렬한다. */
export function toModelMessages(messages: any[]): any[] {
  const results = new Map<string, any>();
  for (const m of messages) if (m?.role === "tool" && typeof m.toolCallId === "string") results.set(m.toolCallId, m);
  const out: any[] = [];
  for (const m of messages) {
    if (m?.role === "user") {
      if (typeof m.content === "string") out.push({ role: "user", content: m.content });
      else if (Array.isArray(m.content)) {
        const parts: any[] = [];
        for (const p of m.content) {
          if (p?.type === "text") parts.push({ type: "text", text: String(p.text ?? "") });
          else if (p?.type === "image" && p.source?.type === "data") parts.push({ type: "image_url", image_url: { url: `data:${p.source.mimeType};base64,${p.source.value}` } });
          // 쓸 수 없는 부분(URL 이미지, 음성 등)은 건너뛴다. run을 실패시키지 않는다.
        }
        out.push({ role: "user", content: parts });
      }
    } else if (m?.role === "assistant") {
      const calls = Array.isArray(m.toolCalls) ? m.toolCalls.filter((c: any) => c?.id && c.function?.name) : [];
      if (!calls.length) {
        if (partText(m.content)) out.push({ role: "assistant", content: partText(m.content) });
        continue;
      }
      out.push({ role: "assistant", content: partText(m.content) || null, tool_calls: calls.map((c: any) => ({ id: c.id, type: "function", function: { name: c.function.name, arguments: String(c.function.arguments ?? "{}") } })) });
      for (const c of calls) {
        const r = results.get(c.id);
        out.push({ role: "tool", tool_call_id: c.id, content: r ? partText(r.content) || "{}" : JSON.stringify({ note: "응답이 없었습니다. 다시 묻지 말고 진행하세요." }) });
      }
    }
    // tool 메시지는 위에서 호출 뒤에 붙였다. activity·reasoning 등은 모델에 보내지 않는다.
  }
  return out;
}

function checkImages(messages: any[]) {
  for (const m of messages) {
    if (m?.role !== "user" || !Array.isArray(m.content)) continue;
    for (const p of m.content) {
      if (p?.type !== "image") continue;
      if (p.source?.type !== "data" || !IMAGE_TYPES.includes(p.source.mimeType) || String(p.source.value ?? "").length > MAX_IMAGE_CHARS)
        throw new BadInput("이미지는 5MB 이하의 PNG·JPEG·WEBP를 base64 데이터로 보내야 합니다.");
    }
  }
}

/* ---------- 지출 에이전트 ---------- */

export async function handleExpenseRun(req: Request, deps?: LinerDeps): Promise<Response> {
  let input;
  try {
    input = await readInput(req);
    checkImages(input.messages as any[]);
  } catch (e) {
    return bad(e instanceof BadInput ? e.message : "요청을 처리할 수 없습니다.");
  }
  const st = (input.state && typeof input.state === "object" ? input.state : {}) as any;
  const record = normalizeRecord(st.record);
  const locked: string[] = Array.isArray(st.locked) ? st.locked.map(String) : [];
  const ev = st.evidence ?? {};
  const evidence = { kind: ["receipt", "alternative", "none"].includes(ev.kind) ? ev.kind : "none", hasImage: !!ev.hasImage, hasReason: !!ev.hasReason } as const;
  const history = Array.isArray(st.history) ? st.history.slice(0, 50) : [];
  const aiFields: string[] = Array.isArray(st.aiFields) ? st.aiFields.map(String) : [];
  const canAsk = (input.tools ?? []).some((t: any) => t?.name === ASK_USER_TOOL);

  // 첫 사용자 메시지의 글 앞에 현재 기록을 붙여 모델에 넘긴다.
  const messages = toModelMessages(input.messages as any[]);
  const first = messages.find((m) => m.role === "user");
  if (!first) return bad("messages에 user 메시지가 필요합니다.");
  const hasImage = Array.isArray(first.content) && first.content.some((p: any) => p.type === "image_url");
  // 화면이 context로 넘긴 참고 정보(단체 이름, 지원기관 등)를 함께 알려 준다.
  const ctx = (input.context ?? []).filter((c: any) => c?.value).map((c: any) => `${String(c.description).slice(0, 40)}: ${String(c.value).slice(0, 100)}`).slice(0, 6);
  const kickoff = expenseKickoffText(partText(first.content), record, locked, evidence, hasImage) + (ctx.length ? `\n참고 정보 (검색어를 만들 때 쓰세요):\n${ctx.join("\n")}` : "");
  first.content = Array.isArray(first.content) ? [{ type: "text", text: kickoff }, ...first.content.filter((p: any) => p.type !== "text")] : kickoff;

  return sse(
    input,
    async (emit) => {
      const snapshot = { record, docType: "", locked, aiFields, evidence, history, sources: toSources(st.sources ?? []), searches: Number(st.searches) || 0, asks: Number(st.asks) || 0, summary: "", checklist: [] as unknown[] };
      emit({ type: EventType.STATE_SNAPSHOT, snapshot });
      const last = (input.messages as any[]).at(-1);
      if (last?.role === "tool") emit({ type: EventType.ACTIVITY_SNAPSHOT, messageId: `act-answer-${input.runId}`, activityType: ACTIVITY_TYPE, content: { tool: ASK_USER_TOOL, label: "답변을 받았습니다", detail: "" } });

      const hooks = eventHooks(emit);
      const known = new Set(aiFields);
      const out = await runExpenseAgent(
        { messages, record, locked, evidence, history, sources: snapshot.sources, searches: snapshot.searches, asks: snapshot.asks, canAsk },
        deps ?? defaultDeps(),
        {
          ...hooks,
          onRecord(applied: RecordValues) {
            const delta: object[] = [];
            for (const [f, v] of Object.entries(applied)) {
              delta.push({ op: "add", path: `/record/${f}`, value: v });
              if (!known.has(f)) {
                known.add(f);
                delta.push({ op: "add", path: "/aiFields/-", value: f });
              }
            }
            emit({ type: EventType.STATE_DELTA, delta });
          },
          onDocType(docType: string) {
            emit({ type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/docType", value: docType }] });
          },
        },
      );
      emit({
        type: EventType.STATE_DELTA,
        delta: [
          { op: "replace", path: "/sources", value: out.sources },
          { op: "replace", path: "/searches", value: out.searches },
          { op: "replace", path: "/asks", value: out.asks },
          { op: "replace", path: "/summary", value: out.summary },
          { op: "replace", path: "/checklist", value: out.checklist },
        ],
      });
      if (out.status === "ask") return { pendingToolCallIds: [out.pendingCallId!] };
      if (out.summary) {
        const messageId = `sum-${input.runId}`;
        emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: out.summary });
        emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      }
      return { result: { status: "done", checklist: out.checklist.length } };
    },
    "agent/expense",
  );
}

/* ---------- 마감 점검 에이전트 ---------- */

export async function handleCloseRun(req: Request, deps?: LinerDeps): Promise<Response> {
  let input;
  try {
    input = await readInput(req);
  } catch (e) {
    return bad(e instanceof BadInput ? e.message : "요청을 처리할 수 없습니다.");
  }
  const st = (input.state && typeof input.state === "object" ? input.state : {}) as any;
  if (!Array.isArray(st.records)) return bad("state.records가 필요합니다.");
  const project = String(st.project ?? "").slice(0, 100);
  const records = (st.records as Expense[]).slice(0, 100);
  const messages = toModelMessages(input.messages as any[]);
  return sse(
    input,
    async (emit) => {
      emit({ type: EventType.STATE_SNAPSHOT, snapshot: { project, records, briefing: "", requests: [] } });
      const out = await runCloseAgent({ project, records, messages }, deps ?? defaultDeps(), {
        ...eventHooks(emit),
        onRequest: () => {},
      });
      emit({ type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/briefing", value: out.briefing }, { op: "replace", path: "/requests", value: out.requests }] });
      const messageId = `brief-${input.runId}`;
      emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
      emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: out.briefing });
      emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      return { result: { status: "done", requests: out.requests.length } };
    },
    "agent/close",
  );
}

/* ---------- 묶음 에이전트 ---------- */

/** 같은 거래의 서류 찾기. state.documents에 서류 요약 목록을 받는다 (사진은 받지 않는다). */
export async function handleGroupRun(req: Request, deps?: LinerDeps): Promise<Response> {
  let input;
  try {
    input = await readInput(req);
  } catch (e) {
    return bad(e instanceof BadInput ? e.message : "요청을 처리할 수 없습니다.");
  }
  const st = (input.state && typeof input.state === "object" ? input.state : {}) as any;
  if (!Array.isArray(st.documents)) return bad("state.documents가 필요합니다.");
  const documents = st.documents.slice(0, 60);
  const messages = toModelMessages(input.messages as any[]);
  return sse(
    input,
    async (emit) => {
      emit({ type: EventType.STATE_SNAPSHOT, snapshot: { documents, groups: [], note: "" } });
      const out = await runGroupAgent({ documents, messages }, deps ?? defaultDeps(), eventHooks(emit));
      emit({ type: EventType.STATE_DELTA, delta: [{ op: "replace", path: "/groups", value: out.groups }, { op: "replace", path: "/note", value: out.note }] });
      const messageId = `group-${input.runId}`;
      emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
      emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: out.note });
      emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      return { result: { status: "done", groups: out.groups.length } };
    },
    "agent/group",
  );
}
