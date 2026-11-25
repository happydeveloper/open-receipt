// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 열린영수증 에이전트. 목표를 주면 모델이 도구를 골라 가며 스스로 반복한다.
 * - 지출 에이전트: 지출 한 건의 증빙 묶음을 완성한다.
 * - 마감 점검 에이전트: 사업의 모든 기록을 훑어 보완 요청 초안과 브리핑을 만든다.
 * 승인·확정 도구는 없다. 상태를 바꾸는 것은 항상 사람이다.
 */
import { chatWithTools, searchWeb, type LinerDeps, defaultDeps, type ToolCall } from "./liner";
import { normalizeAmount } from "./draft";
import { cleanProposals, DOC_TYPES, normalizeDocType, type GroupDoc, type GroupProposal } from "./group";
import { softenJudgment } from "./guard";
import { toSources } from "./guidelines";
import { maskText } from "./mask";
import { evidenceMissing, missingFields, newExpense, openItems, withStatus } from "./status";
import { PAYMENT_LABEL, STATUS_LABEL, type ChecklistItem, type Expense, type PaymentMethod, type Source } from "./types";

export interface AgentStep {
  tool: string;
  label: string;
  detail?: string;
}
export const RECORD_FIELDS = ["date", "amount", "merchant", "item", "paymentMethod", "purpose", "project", "budgetCategory", "payer", "reimbursement"] as const;
export type RecordField = (typeof RECORD_FIELDS)[number];
export type RecordValues = Partial<Record<RecordField, string | number | null>>;
export interface AgentQuestion {
  field: RecordField;
  text: string;
}
export interface HistoryItem {
  project: string;
  item: string;
  budgetCategory: string;
  paymentMethod: string;
  amount: number | null;
  date: string;
}
export interface ExpenseRunInput {
  /** 모델에 보낼 대화 (OpenAI 형식). AG-UI 메시지에서 변환해 넘긴다. */
  messages: any[];
  record: RecordValues;
  /** 사람이 직접 넣은 필드. 에이전트가 덮어쓰지 못한다. */
  locked?: string[];
  evidence: { kind: "receipt" | "alternative" | "none"; hasImage: boolean; hasReason: boolean };
  history?: HistoryItem[];
  sources?: Source[];
  searches?: number;
  asks?: number;
  /** 클라이언트가 ask_user 도구를 제공했는지. 없으면 묻지 않고 진행한다. */
  canAsk?: boolean;
}
export interface ExpenseRunOutput {
  status: "ask" | "done";
  /** 사진이 어떤 서류인지 (카드영수증, 거래명세서 …). 읽지 못했으면 빈 문자열 */
  docType: string;
  record: RecordValues;
  aiFields: string[];
  questions: AgentQuestion[];
  /** 사용자의 답을 기다리는 ask_user 호출 id */
  pendingCallId?: string;
  summary: string;
  checklist: ChecklistItem[];
  sources: Source[];
  searches: number;
  asks: number;
}
/** 루프가 진행되는 동안 바깥(AG-UI 어댑터)에 알리는 훅. */
export interface LoopHooks {
  onCall?(c: { id: string; name: string; args: unknown; parentId: string }): void;
  onResult?(c: { id: string; name: string; content: string }): void;
  onStep?(s: AgentStep, callId?: string): void;
  onRecord?(applied: RecordValues): void;
  onDocType?(docType: string): void;
}

/** 도구 하나를 실행한 결과. result는 모델에게 돌려주고, step은 화면에 보여 준다. */
interface ToolResult {
  result: unknown;
  step?: AgentStep;
  /** 루프를 멈추고 호출자에게 돌려줄 값 */
  stop?: unknown;
  /** true면 도구 응답을 지금 보내지 않는다 (사용자 답을 기다림) */
  defer?: boolean;
  /** 바깥에 알릴 때 쓸 인자 (검증·정리된 값). 없으면 모델이 준 인자 그대로. */
  emitArgs?: unknown;
}
/** 에이전트가 고를 수 있는 도구. 이 목록에 없는 일은 에이전트가 할 수 없다 (승인·확정·발송 도구는 만들지 않았다). */
interface Tool {
  name: string;
  description: string;
  parameters: object;
  run(args: any, call: ToolCall): Promise<ToolResult> | ToolResult;
}

// 한 번의 실행에서 허용하는 모델 호출, 검색, 질문 횟수. 끝없이 돌거나 크레딧을 다 쓰는 일을 막는다.
export const MAX_TURNS = 10;
export const MAX_SEARCHES = 3;
export const MAX_ASKS = 2;
const PAYMENTS: PaymentMethod[] = ["org_card", "transfer", "personal", "cash"];
const FIELD_LABEL: Record<RecordField, string> = {
  date: "일자", amount: "금액", merchant: "가맹점", item: "항목", paymentMethod: "결제 방식",
  purpose: "목적", project: "사업·행사", budgetCategory: "예산 항목", payer: "결제자", reimbursement: "환급 여부",
};

/** 모델이 준 도구 인자(JSON 문자열). 깨져 있으면 빈 객체로 본다. */
function parseArgs(raw: string): any {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** 모델이 도구를 고르고, 결과를 보고 다음 도구를 고르는 반복. 멈춤 값이 나오거나 턴이 다하면 끝난다. */
async function runLoop(opts: {
  system: string;
  messages: any[];
  tools: Tool[];
  deps: LinerDeps;
  hooks?: LoopHooks;
  maxTurns?: number;
}): Promise<unknown | null> {
  const specs = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  for (let turn = 0; turn < (opts.maxTurns ?? MAX_TURNS); turn++) {
    const m = await chatWithTools({ messages: [{ role: "system", content: opts.system }, ...opts.messages], tools: specs }, opts.deps);
    // 도구 없이 말만 했으면 도구를 쓰라고 한 번 더 알려 준다.
    if (m.toolCalls.length === 0) {
      opts.messages.push({ role: "assistant", content: m.content ?? "" });
      opts.messages.push({ role: "user", content: "도구를 호출해 계속 진행하세요. 다 끝났다면 finish를 호출하세요." });
      continue;
    }
    const parentId = `msg-${m.toolCalls[0].id}`;
    const done: { call: ToolCall; r: ToolResult }[] = [];
    let stop: unknown = null;
    for (const call of m.toolCalls) {
      const tool = opts.tools.find((t) => t.name === call.function.name);
      const args = parseArgs(call.function.arguments);
      let r: ToolResult;
      // 같은 턴에서 앞선 도구가 멈춤을 냈으면(끝내기, 질문) 뒤따르는 호출은 실행하지 않는다.
      if (stop !== null) r = { result: { skipped: "이번 턴은 여기서 멈췄습니다." } };
      else if (!tool) r = { result: { error: `없는 도구입니다: ${call.function.name}` } };
      else r = await tool.run(args, call);
      // 대화 기록과 화면에는 검증을 거친 인자를 남긴다 (모델이 준 원본이 아니라).
      const shown = r.emitArgs ?? args;
      const kept: ToolCall = { ...call, function: { name: call.function.name, arguments: JSON.stringify(shown) } };
      opts.hooks?.onCall?.({ id: call.id, name: call.function.name, args: shown, parentId });
      if (r.step) opts.hooks?.onStep?.(r.step, call.id);
      if (!r.defer) opts.hooks?.onResult?.({ id: call.id, name: call.function.name, content: JSON.stringify(r.result) });
      if (r.stop !== undefined && stop === null) stop = r.stop;
      done.push({ call: kept, r });
    }
    opts.messages.push({ role: "assistant", content: m.content, tool_calls: done.map((d) => d.call) });
    // 사용자 답을 기다리는 호출(defer)에는 도구 응답을 붙이지 않는다. 답은 다음 실행에서 온다.
    for (const d of done) if (!d.r.defer) opts.messages.push({ role: "tool", tool_call_id: d.call.id, content: JSON.stringify(d.r.result) });
    if (stop !== null) return stop;
  }
  return null;
}

/** 공개 지침 검색 도구. 두 에이전트가 함께 쓴다. 찾은 출처는 state.sources에 쌓인다. */
function searchTool(state: { sources: Source[]; searches: number }, deps: LinerDeps): Tool {
  return {
    name: "search_guidelines",
    description: "Liner Search로 공개된 정산·증빙 지침을 검색한다. 결과가 이 지출과 관련 없으면 검색어를 바꿔 다시 부를 수 있다 (최대 3회).",
    parameters: { type: "object", properties: { query: { type: "string", description: "한국어 검색어. 지출 종류, 결제 방식, '정산 증빙 지침' 같은 말을 조합" } }, required: ["query"] },
    async run(args) {
      const query = String(args.query ?? "").trim().slice(0, 120);
      if (!query) return { result: { error: "검색어가 비어 있습니다." } };
      if (state.searches >= MAX_SEARCHES) return { result: { error: "검색 횟수를 다 썼습니다. 지금까지의 결과로 마무리하세요." } };
      state.searches++;
      const found = toSources(await searchWeb(query, deps, 8));
      for (const s of found) if (!state.sources.some((x) => x.url === s.url)) state.sources.push(s);
      return {
        result: { query, results: found.map((s) => ({ title: s.title, url: s.url, date: s.date ?? "미상", content: s.description.slice(0, 700) })) },
        step: { tool: "search_guidelines", label: `공개 지침을 검색했습니다 (${found.length}건)`, detail: query },
      };
    },
  };
}

/** "확인할 자료" 가운데 검색 결과에 실제로 있는 주소가 달린 항목만 남긴다. 모델이 지어낸 출처를 막는다. */
function validChecklist(raw: unknown, sources: Source[]): ChecklistItem[] {
  const urls = new Set(sources.map((s) => s.url));
  const out: ChecklistItem[] = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c.text !== "string" || !c.text.trim() || !urls.has(c.sourceUrl)) continue;
    out.push({ text: softenJudgment(c.text.trim()).text, sourceUrl: c.sourceUrl });
    if (out.length >= 5) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 지출 에이전트                                                       */
/* ------------------------------------------------------------------ */

export const EXPENSE_SYSTEM = `당신은 소규모 비영리단체·동아리의 총무를 돕는 "열린영수증" 에이전트입니다.
목표: 지출 한 건의 "증빙 묶음"(영수증, 목적, 사업·행사, 결제, 책임)을 정산 가능한 기록으로 완성해 사람에게 넘깁니다.
도구를 스스로 골라 순서대로 진행하세요. 한 번에 여러 도구를 불러도 됩니다.

일하는 방식:
1. 가장 먼저, 영수증 이미지와 메모에 보이는 값(일자, 합계 금액, 가맹점, 결제 방식, 항목)을 update_record로 옮깁니다. 보이지 않는 값은 넣지 않습니다. item은 품목 나열이 아니라 "행사 다과"처럼 2~4단어의 지출 이름으로 씁니다. 이미지가 있으면 어떤 서류인지도 docType에 적습니다 (카드영수증, 간이영수증, 거래명세서, 주문내역(쇼핑몰 주문 화면 캡처), 이체확인증, 견적서, 기타).
2. lookup_history로 이 단체의 지난 기록을 확인합니다. 지난 기록의 사업·행사가 하나뿐이고 이번 지출 날짜와 맞으면 project를, 비슷한 지출이 있으면 budgetCategory를 채웁니다.
3. check_bundle로 무엇이 빠졌는지 확인합니다.
4. 스스로 알 수 없는 것만 ask_user로 묻습니다. 목적, 결제자, 환급 여부는 추측하지 말고 물으세요. 한 번에 최대 3개, 친근한 한국어로.
5. 필수 정보가 갖춰지면 search_guidelines로 이 지출과 관련된 공개 정산·증빙 지침을 찾습니다. 지출 종류(예: 다과비·회의비), 결제 방식(예: 개인카드 선결제 환급, 현금), 지원기관을 넣어 구체적으로 검색합니다. 결과가 일반론뿐이거나 관련이 없으면 검색어를 바꿔 다시 찾습니다. 예: "보조금 회의비 다과비 증빙서류 참석자 명단", "지출결의서 영수증 첨부 개인카드 사용 환급 지침".
6. finish로 마무리합니다. summary는 두 문장 이내의 기록 요약, checklist는 담당자가 챙길 자료나 확인할 일입니다. 검색 결과에 적힌 서류·증빙·절차를 하나씩 따로 항목으로 만들어 2~4개를 목표로 합니다. 이 지출에 실제로 해당하는 것만 넣습니다.

규칙:
- checklist의 각 항목은 검색 결과에 실제로 적힌 내용만 근거로 쓰고, 그 결과의 url을 sourceUrl에 그대로 넣습니다. 근거가 없으면 빈 배열로 둡니다.
- "적법", "부적법", "위반" 같은 판정은 하지 않습니다. "보관하세요", "확인하세요"처럼 행동으로 안내합니다.
- 승인과 환급 결정은 사람이 합니다. 당신은 기록을 준비할 뿐입니다.
- 사람이 직접 넣은 값은 바꾸지 않습니다.
- 영수증에 "시연용", "견본", "가상" 같은 표시가 있어도 진짜인지 따지지 말고 보이는 값을 그대로 기록합니다. 기록할지 말지는 사람이 정합니다.
- 필수 정보(일자, 금액, 항목, 사업·행사, 결제 방식)가 비어 있는 채로 finish 하지 않습니다. 영수증·메모에 보이면 채우고, 없으면 묻습니다.`;

/** 모델이 요약을 주지 않았을 때 기록에서 만드는 요약 문장. */
function fallbackSummary(r: RecordValues): string {
  const pay =
    r.paymentMethod === "personal"
      ? `${r.payer || "담당자"} 개인 선결제${r.reimbursement === "needed" ? ", 환급 요청" : ""}`
      : r.paymentMethod && PAYMENTS.includes(r.paymentMethod as PaymentMethod)
        ? PAYMENT_LABEL[r.paymentMethod as PaymentMethod]
        : "";
  return [`${r.project ? r.project + " " : ""}${r.purpose || r.item || "지출"}.`, pay ? pay + "." : ""].filter(Boolean).join(" ");
}

/** 지금까지 채운 값을 Expense 모양으로 바꾼다. 화면과 같은 규칙(lib/status.ts)으로 빠진 것을 점검하려는 것이다. */
function toExpense(r: RecordValues, ev: ExpenseRunInput["evidence"]): Expense {
  return newExpense({
    id: "agent",
    date: String(r.date ?? ""),
    item: String(r.item ?? ""),
    amount: typeof r.amount === "number" ? r.amount : null,
    merchant: String(r.merchant ?? ""),
    purpose: String(r.purpose ?? ""),
    project: String(r.project ?? ""),
    budgetCategory: String(r.budgetCategory ?? ""),
    paymentMethod: PAYMENTS.includes(r.paymentMethod as PaymentMethod) ? (r.paymentMethod as PaymentMethod) : null,
    payer: String(r.payer ?? ""),
    reimbursement: r.reimbursement === "needed" || r.reimbursement === "not_needed" ? r.reimbursement : "unknown",
    evidence: { kind: ev.kind, image: ev.hasImage ? "attached" : undefined, reason: ev.hasReason ? "입력됨" : undefined },
    confirmed: true,
  });
}

/** 이 필드에 쓸 수 있는 값이 들어 있는지. */
function isFilled(r: RecordValues, f: RecordField): boolean {
  const v = r[f];
  if (f === "reimbursement") return v === "needed" || v === "not_needed";
  if (f === "amount") return typeof v === "number" && v > 0;
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/** 값 하나를 검증·정규화한다. 쓸 수 없는 값이면 undefined. */
export function normalizeField(f: RecordField, v: unknown): string | number | undefined {
  if (v === null || v === undefined) return undefined;
  if (f === "amount") return normalizeAmount(v) ?? undefined;
  const s = String(v).trim().slice(0, 100);
  if (!s) return undefined;
  if (f === "date") return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
  if (f === "paymentMethod") return PAYMENTS.includes(s as PaymentMethod) ? s : undefined;
  if (f === "reimbursement") return s === "needed" || s === "not_needed" ? s : undefined;
  return s;
}

/** 첫 사용자 메시지에 넣을 글 (메모와 현재 기록). */
export function expenseKickoffText(memo: string, record: RecordValues, locked: string[], evidence: ExpenseRunInput["evidence"], hasImage: boolean): string {
  return (
    `메모: ${maskText(memo ?? "") || "(없음)"}\n` +
    `현재 기록: ${JSON.stringify(record)}\n` +
    `사람이 직접 넣은 필드: ${locked.join(", ") || "(없음)"}\n` +
    (hasImage
      ? "영수증 이미지를 첨부했습니다 (민감정보는 가려져 있습니다)."
      : evidence.kind === "alternative"
        ? "영수증이 없어 대체 증빙으로 처리하는 건입니다. 메모만으로 진행하세요."
        : "영수증 이미지는 없습니다. 메모만으로 진행하세요.")
  );
}

export function normalizeRecord(raw: unknown): RecordValues {
  const record: RecordValues = {};
  for (const f of RECORD_FIELDS) {
    const v = normalizeField(f, (raw as any)?.[f]);
    if (v !== undefined) record[f] = v;
  }
  return record;
}

export async function runExpenseAgent(input: ExpenseRunInput, deps: LinerDeps = defaultDeps(), hooks: LoopHooks = {}): Promise<ExpenseRunOutput> {
  const record = normalizeRecord(input.record);
  const locked = new Set((input.locked ?? []).filter((f) => (RECORD_FIELDS as readonly string[]).includes(f)));
  const aiFields = new Set<string>();
  const state = { sources: toSources(input.sources ?? []), searches: Number(input.searches) || 0, asks: Number(input.asks) || 0 };
  const messages = input.messages;
  const canAsk = input.canAsk !== false;
  let finishWarned = false;
  let lastChecked = "";
  let docType = "";

  const tools: Tool[] = [
    {
      name: "update_record",
      description: "영수증·메모·지난 기록에서 확인한 값을 지출 기록에 반영한다. 확인한 필드만 넣는다.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          amount: { type: "integer", description: "합계 금액(원)" },
          merchant: { type: "string" },
          item: { type: "string", description: "2~4단어의 지출 이름. 예: 행사 다과" },
          paymentMethod: { type: "string", enum: PAYMENTS, description: "org_card 조직카드, transfer 계좌이체, personal 개인 카드·사비, cash 현금" },
          purpose: { type: "string" },
          project: { type: "string" },
          budgetCategory: { type: "string" },
          payer: { type: "string" },
          reimbursement: { type: "string", enum: ["needed", "not_needed"] },
          docType: { type: "string", enum: [...DOC_TYPES], description: "이미지가 어떤 서류인지. 나중에 같은 거래의 서류를 묶을 때 쓴다" },
        },
      },
      run(args) {
        const applied: string[] = [];
        const skipped: string[] = [];
        // 서류 종류는 기록 값이 아니라 사진에 대한 정보다. 따로 적어 둔다.
        const seen = normalizeDocType(args.docType);
        if (seen && seen !== docType) { docType = seen; hooks.onDocType?.(seen); }
        for (const f of RECORD_FIELDS) {
          if (!(f in args)) continue;
          const v = normalizeField(f, args[f]);
          if (v === undefined) continue;
          if (locked.has(f)) {
            skipped.push(f);
            continue;
          }
          record[f] = v;
          aiFields.add(f);
          applied.push(f);
        }
        if (applied.length) hooks.onRecord?.(Object.fromEntries(applied.map((f) => [f, record[f as RecordField]])) as RecordValues);
        return {
          result: { applied, skippedBecauseUserEntered: skipped, record },
          step: applied.length ? { tool: "update_record", label: "기록을 채웠습니다", detail: applied.map((f) => FIELD_LABEL[f as RecordField]).join(", ") } : undefined,
        };
      },
    },
    {
      name: "lookup_history",
      description: "이 단체의 지난 지출 기록을 조회한다. 사업·행사 이름과 예산 항목을 추정할 때 쓴다.",
      parameters: { type: "object", properties: {} },
      run() {
        const hist = input.history ?? [];
        const count = (key: (h: HistoryItem) => string) => {
          const m = new Map<string, number>();
          for (const h of hist) if (key(h)) m.set(key(h), (m.get(key(h)) ?? 0) + 1);
          return [...m].map(([name, n]) => ({ name, count: n }));
        };
        return {
          result: { projects: count((h) => h.project), budgetCategories: count((h) => h.budgetCategory), recent: hist.slice(-10) },
          step: { tool: "lookup_history", label: "지난 기록을 확인했습니다", detail: `${hist.length}건` },
        };
      },
    },
    {
      name: "check_bundle",
      description: "증빙 묶음에서 빠진 것을 점검한다. 필수 정보, 증빙 유무, 묻거나 채워야 할 항목을 돌려준다.",
      parameters: { type: "object", properties: {} },
      run() {
        const sig = JSON.stringify(record);
        if (sig === lastChecked) return { result: { note: "직전 점검 이후 기록이 바뀌지 않았습니다. 다시 점검하지 말고 다음 단계(묻기, 검색, 마무리)로 진행하세요." } };
        lastChecked = sig;
        const e = toExpense(record, input.evidence);
        const soft: string[] = [];
        if (!isFilled(record, "purpose")) soft.push("purpose");
        if (!isFilled(record, "budgetCategory")) soft.push("budgetCategory");
        if (record.paymentMethod === "personal") {
          if (!isFilled(record, "payer")) soft.push("payer");
          if (!isFilled(record, "reimbursement")) soft.push("reimbursement");
        }
        const missing = missingFields(e);
        const gaps = missing.length + soft.length;
        return {
          result: { missingRequired: missing, missingOptional: soft, evidenceMissing: evidenceMissing(e), nextActionsForHuman: openItems(e).map((o) => o.text), record },
          step: { tool: "check_bundle", label: gaps ? `증빙 묶음을 점검했습니다: 빠진 항목 ${gaps}개` : "증빙 묶음을 점검했습니다: 빠진 항목 없음", detail: [...missing, ...soft.map((f) => FIELD_LABEL[f as RecordField])].join(", ") },
        };
      },
    },
    {
      name: "ask_user",
      description: "스스로 알 수 없는 정보를 사용자에게 묻는다. 한 번에 최대 3개. 이미 채워진 항목은 묻지 않는다.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: { type: "object", properties: { field: { type: "string", enum: RECORD_FIELDS }, text: { type: "string" } }, required: ["field", "text"] },
          },
        },
        required: ["questions"],
      },
      run(args, call) {
        if (!canAsk || state.asks >= MAX_ASKS) return { result: { error: "더 물을 수 없습니다. 지금 있는 정보로 진행해 마무리하세요." } };
        const seen = new Set<string>();
        const questions: AgentQuestion[] = [];
        for (const q of Array.isArray(args.questions) ? args.questions : []) {
          if (!q || !(RECORD_FIELDS as readonly string[]).includes(q.field) || typeof q.text !== "string" || !q.text.trim()) continue;
          const f = q.field as RecordField;
          const key = f === "payer" ? "reimbursement" : f; // 결제자와 환급 여부는 한 카드에서 함께 묻는다
          if (seen.has(key) || (isFilled(record, f) && !(f === "payer" || f === "reimbursement"))) continue;
          if ((f === "payer" || f === "reimbursement") && isFilled(record, "payer") && isFilled(record, "reimbursement")) continue;
          seen.add(key);
          questions.push({ field: f, text: softenJudgment(q.text.trim()).text });
          if (questions.length >= 3) break;
        }
        if (questions.length === 0) return { result: { note: "물으려는 항목은 이미 채워져 있습니다. 다음 단계로 진행하세요." } };
        state.asks++;
        return { result: null, defer: true, emitArgs: { questions }, stop: { status: "ask", questions, pendingCallId: call.id }, step: { tool: "ask_user", label: `알 수 없는 ${questions.length}가지를 여쭙니다`, detail: questions.map((q) => FIELD_LABEL[q.field]).join(", ") } };
      },
    },
    searchTool(state, deps),
    {
      name: "finish",
      description: "증빙 묶음 정리를 마친다. 요약과 확인할 자료 체크리스트를 사람에게 넘긴다.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "두 문장 이내의 기록 요약" },
          checklist: {
            type: "array",
            items: { type: "object", properties: { text: { type: "string" }, sourceUrl: { type: "string", description: "근거가 된 검색 결과의 url" } }, required: ["text", "sourceUrl"] },
          },
        },
        required: ["summary", "checklist"],
      },
      run(args) {
        // 필수 정보가 빈 채로 끝내려 하면 한 번 돌려보낸다.
        const missing = missingFields(toExpense(record, input.evidence));
        if (missing.length && !finishWarned && canAsk) {
          finishWarned = true;
          return { result: { error: `아직 마칠 수 없습니다. 필수 정보가 비어 있습니다: ${missing.join(", ")}. 영수증·메모에 보이면 update_record로 채우고, 알 수 없으면 ask_user로 물은 뒤 다시 finish 하세요.` } };
        }
        const checklist = validChecklist(args.checklist, state.sources);
        const summary = softenJudgment(String(args.summary ?? "").trim()).text || fallbackSummary(record);
        return {
          result: { ok: true },
          stop: { status: "done", summary, checklist },
          step: { tool: "finish", label: "정리를 마쳤습니다", detail: checklist.length ? `확인할 자료 ${checklist.length}건` : "연결할 공개 지침을 찾지 못했습니다" },
        };
      },
    },
  ];

  // 화면이 질문 도구를 제공하지 않은 실행에서는 묻지 않고 있는 정보로 마무리하게 한다.
  const usable = canAsk ? tools : tools.filter((t) => t.name !== "ask_user");
  const system = canAsk ? EXPENSE_SYSTEM : EXPENSE_SYSTEM + "\n\n이번 실행에서는 사용자에게 물을 수 없습니다. 있는 정보로 기록을 채우고, 빠진 것은 그대로 둔 채 finish로 마무리하세요.";
  const stop = (await runLoop({ system, messages, tools: usable, deps, hooks })) as any;
  const base = { record, docType, aiFields: [...aiFields], sources: state.sources, searches: state.searches, asks: state.asks };
  if (stop?.status === "ask") return { ...base, status: "ask", questions: stop.questions, pendingCallId: stop.pendingCallId, summary: "", checklist: [] };
  if (stop?.status === "done") return { ...base, status: "done", questions: [], summary: stop.summary, checklist: stop.checklist };
  hooks.onStep?.({ tool: "finish", label: "정리를 마쳤습니다", detail: "단계 수 한도에 도달해 지금까지의 내용으로 마무리" });
  return { ...base, status: "done", questions: [], summary: fallbackSummary(record), checklist: [] };
}

/* ------------------------------------------------------------------ */
/* 마감 점검 에이전트                                                  */
/* ------------------------------------------------------------------ */

export interface CloseRequest {
  id: string;
  item: string;
  amount: number;
  to: string;
  message: string;
}
export interface CloseAgentOutput {
  briefing: string;
  requests: CloseRequest[];
  sources: Source[];
}

export const CLOSE_SYSTEM = `당신은 소규모 단체의 월말 정산 마감을 돕는 "열린영수증" 마감 점검 에이전트입니다.
목표: 이 사업의 지출 기록을 모두 훑어, 제출 전에 보완이 필요한 건마다 담당자에게 보낼 요청 문안을 준비하고 대표에게 줄 브리핑을 만듭니다.

일하는 방식:
1. list_records로 전체 기록과 상태를 봅니다.
2. 보완이 필요한 건은 inspect_record로 자세히 확인합니다.
3. 필요하면 search_guidelines로 관련 공개 지침을 찾아 근거로 삼습니다.
4. 보완이 필요한 건마다 draft_request로 요청 문안을 씁니다. 무엇을 언제까지 어떻게 하면 되는지 2~3문장으로, 정중하고 구체적으로 씁니다. 승인만 남은 건은 승인자에게 확인을 부탁하는 문안을 씁니다.
5. finish로 브리핑을 넘깁니다. 총 건수와 금액, 보완이 필요한 건과 다음 행동을 4문장 이내로 씁니다.

규칙:
- "위반", "부적법" 같은 판정은 하지 않습니다. 확인할 항목과 다음 행동만 말합니다.
- 승인과 환급 결정은 사람이 합니다. 당신은 메시지를 보내지 않고 초안만 씁니다.
- 기록에 없는 사실을 지어내지 않습니다.`;

export async function runCloseAgent(
  input: { project: string; records: Expense[]; messages?: any[] },
  deps: LinerDeps = defaultDeps(),
  hooks: LoopHooks & { onRequest?(r: CloseRequest): void } = {},
): Promise<CloseAgentOutput> {
  const records = (Array.isArray(input.records) ? input.records : []).slice(0, 100).map((e) => withStatus({ ...e, guidance: undefined }));
  const state = { sources: [] as Source[], searches: 0 };
  const requests = new Map<string, CloseRequest>();
  const brief = (e: Expense) => ({
    id: e.id, date: e.date, item: e.item, amount: e.amount, payment: e.paymentMethod ? PAYMENT_LABEL[e.paymentMethod] : "",
    status: STATUS_LABEL[e.status], openItems: openItems(e).map((o) => o.text),
  });
  const tools: Tool[] = [
    {
      name: "list_records",
      description: "이 사업의 모든 지출 기록과 상태, 확인할 항목을 조회한다.",
      parameters: { type: "object", properties: {} },
      run() {
        const total = records.reduce((s, e) => s + (e.amount ?? 0), 0);
        return { result: { project: input.project, count: records.length, total, records: records.map(brief) }, step: { tool: "list_records", label: `기록 ${records.length}건을 훑었습니다`, detail: `합계 ${total.toLocaleString("ko-KR")}원` } };
      },
    },
    {
      name: "inspect_record",
      description: "지출 한 건을 자세히 본다 (목적, 결제자, 환급, 증빙, 제출자).",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run(args) {
        const e = records.find((x) => x.id === args.id);
        if (!e) return { result: { error: "그런 기록이 없습니다." } };
        return {
          result: { ...brief(e), purpose: e.purpose, payer: e.payer, reimbursement: e.reimbursement, submittedBy: e.submittedBy, evidence: { kind: e.evidence.kind, hasImage: !!e.evidence.image, altType: e.evidence.altType, reason: e.evidence.reason }, summary: e.summary },
          step: { tool: "inspect_record", label: `${e.item} 건을 살펴봤습니다`, detail: openItems(e).map((o) => o.text).join(" · ") },
        };
      },
    },
    searchTool(state, deps),
    {
      name: "draft_request",
      description: "보완이 필요한 기록 한 건에 대해 담당자(또는 승인자)에게 보낼 요청 문안 초안을 쓴다. 보내지는 않는다.",
      parameters: { type: "object", properties: { id: { type: "string" }, to: { type: "string", description: "받는 사람. 제출자 또는 승인자" }, message: { type: "string" } }, required: ["id", "message"] },
      run(args) {
        const e = records.find((x) => x.id === args.id);
        if (!e) return { result: { error: "그런 기록이 없습니다." } };
        if (e.status === "done") return { result: { error: "이미 완료된 기록입니다. 요청이 필요 없습니다." } };
        const message = softenJudgment(String(args.message ?? "").trim().slice(0, 600)).text;
        if (!message) return { result: { error: "문안이 비어 있습니다." } };
        const to = String(args.to ?? "").trim().slice(0, 40) || e.submittedBy || "담당자";
        requests.set(e.id, { id: e.id, item: e.item, amount: e.amount ?? 0, to, message });
        hooks.onRequest?.(requests.get(e.id)!);
        return { result: { ok: true }, step: { tool: "draft_request", label: `${e.item} 보완 요청 초안을 썼습니다`, detail: `받는 사람: ${to}` } };
      },
    },
    {
      name: "finish",
      description: "마감 점검을 마치고 브리핑을 넘긴다.",
      parameters: { type: "object", properties: { briefing: { type: "string" } }, required: ["briefing"] },
      run(args) {
        return { result: { ok: true }, stop: { briefing: softenJudgment(String(args.briefing ?? "").trim().slice(0, 800)).text }, step: { tool: "finish", label: "마감 점검을 마쳤습니다", detail: `요청 초안 ${requests.size}건` } };
      },
    },
  ];
  const messages: any[] = input.messages?.length ? input.messages : [{ role: "user", content: `"${input.project}" 사업의 정산 마감 전 점검을 해 주세요.` }];
  const stop = (await runLoop({ system: CLOSE_SYSTEM, messages, tools, deps, hooks })) as any;
  const open = records.filter((e) => e.status !== "done").length;
  return {
    briefing: stop?.briefing || `기록 ${records.length}건 중 ${open}건에 확인할 항목이 남아 있습니다.`,
    requests: [...requests.values()],
    sources: state.sources,
  };
}

/* ------------------------------------------------------------------ */
/* 묶음 에이전트                                                        */
/* ------------------------------------------------------------------ */

export interface GroupAgentOutput {
  groups: GroupProposal[];
  note: string;
}

export const GROUP_SYSTEM = `당신은 소규모 단체의 총무를 돕는 "열린영수증" 묶음 에이전트입니다.
목표: 따로 올라온 서류들 가운데 같은 거래 한 건의 서류(카드영수증, 거래명세서, 쇼핑몰 주문 화면 캡처, 이체확인증 등)를 찾아 한 묶음으로 제안합니다. 그대로 두면 한 번 쓴 돈이 여러 건으로 잡힙니다.

일하는 방식:
1. list_documents로 서류 목록을 봅니다. 서류마다 날짜, 금액, 가맹점, 항목, 결제 방식, 서류 종류가 있습니다.
2. 같은 거래로 보이는 서류들을 propose_group으로 제안합니다. 묶음마다 한 번씩 부릅니다.
3. 다 살폈으면 finish로 마칩니다.

같은 거래로 볼 근거:
- 금액이 같고 날짜가 같거나 며칠 안쪽입니다 (주문일, 결제일, 발행일은 다를 수 있습니다).
- 가맹점 표기가 달라도 같은 곳일 수 있습니다. 카드영수증에는 결제대행사나 줄인 이름이, 거래명세서에는 정식 상호가 적힙니다.
- 서류 종류가 서로 다릅니다 (예: 카드영수증 + 거래명세서 + 주문내역). 같은 종류의 서류 두 장이 날짜·금액까지 같으면 같은 서류를 두 번 올린 것일 수 있으니 그 사실을 이유에 적습니다.
- 금액이 조금 다르면 배송비, 할인, 부가세 때문일 수 있습니다. 묶되 mismatch에 무엇이 다른지 적습니다.

규칙:
- 확실하지 않으면 묶지 않습니다. 같은 가게에서 같은 날 따로 산 두 건을 하나로 묶으면 안 됩니다.
- 한 서류는 한 묶음에만 넣습니다.
- mainId에는 결제를 증명하는 서류(카드영수증, 간이영수증)를 우선으로 고릅니다.
- reason은 한두 문장으로, 무엇이 맞아서 묶는지 적습니다. "위반", "부적법" 같은 판정은 하지 않습니다.
- 합치는 것은 사람이 결정합니다. 당신은 제안만 합니다.
- 목록에 없는 사실을 지어내지 않습니다.`;

/** 같은 거래의 서류를 찾아 묶음을 제안한다. 기록을 바꾸는 도구는 없다. */
export async function runGroupAgent(input: { documents: GroupDoc[]; messages?: any[] }, deps: LinerDeps = defaultDeps(), hooks: LoopHooks = {}): Promise<GroupAgentOutput> {
  const docs = (Array.isArray(input.documents) ? input.documents : []).slice(0, 60).map((d) => ({
    id: String(d?.id ?? ""), date: String(d?.date ?? ""), amount: typeof d?.amount === "number" ? d.amount : null, merchant: maskText(String(d?.merchant ?? "")).slice(0, 80),
    item: maskText(String(d?.item ?? "")).slice(0, 80), payment: String(d?.payment ?? "").slice(0, 20), docType: normalizeDocType(d?.docType), photos: Number(d?.photos) || 0,
  })).filter((d) => d.id);
  if (docs.length < 2) return { groups: [], note: "견줄 서류가 두 장보다 적습니다." };
  const raw: unknown[] = [];
  const name = (id: string) => { const d = docs.find((x) => x.id === id); return d ? d.docType || d.item || "서류" : ""; };
  const tools: Tool[] = [
    {
      name: "list_documents",
      description: "따로 올라온 서류 목록을 조회한다 (날짜, 금액, 가맹점, 항목, 결제 방식, 서류 종류).",
      parameters: { type: "object", properties: {} },
      run() {
        return { result: { count: docs.length, documents: docs }, step: { tool: "list_documents", label: `서류 ${docs.length}장을 훑었습니다` } };
      },
    },
    {
      name: "propose_group",
      description: "같은 거래로 보이는 서류들을 한 묶음으로 제안한다. 합치지는 않는다. 사람이 확인한 뒤 합친다.",
      parameters: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" }, description: "묶을 서류의 id (2개 이상)" },
          mainId: { type: "string", description: "남길 서류의 id. 결제를 증명하는 서류를 우선" },
          reason: { type: "string", description: "한두 문장의 이유" },
          mismatch: { type: "string", description: "서류끼리 어긋나는 점. 없으면 빈 문자열" },
        },
        required: ["ids", "reason"],
      },
      run(args) {
        // 지금까지의 제안과 합쳐 검증한다. 새 제안이 살아남지 못했으면 이유를 돌려준다.
        const before = cleanProposals(raw, docs).length;
        const after = cleanProposals([...raw, args], docs);
        if (after.length === before) return { result: { error: "받을 수 없는 묶음입니다. 목록에 있는 서류 2장 이상이어야 하고, 이미 다른 묶음에 든 서류는 넣을 수 없습니다." } };
        raw.push(args);
        const g = after[after.length - 1];
        return { result: { ok: true, ids: g.ids, mainId: g.mainId }, emitArgs: g, step: { tool: "propose_group", label: `서류 ${g.ids.length}장을 한 거래로 제안했습니다`, detail: g.ids.map(name).join(" + ") } };
      },
    },
    {
      name: "finish",
      description: "살피기를 마친다.",
      parameters: { type: "object", properties: { note: { type: "string", description: "한 문장 정리" } } },
      run(args) {
        const n = cleanProposals(raw, docs).length;
        return { result: { ok: true }, stop: { note: softenJudgment(String(args.note ?? "").trim().slice(0, 300)).text }, step: { tool: "finish", label: n ? `묶음 ${n}개를 찾았습니다` : "한 거래로 묶을 서류를 찾지 못했습니다" } };
      },
    },
  ];
  const messages: any[] = input.messages?.length ? input.messages : [{ role: "user", content: "따로 올라온 서류 가운데 같은 거래의 서류를 찾아 묶음을 제안해 주세요." }];
  const stop = (await runLoop({ system: GROUP_SYSTEM, messages, tools, deps, hooks, maxTurns: 6 })) as any;
  const groups = cleanProposals(raw, docs);
  return { groups, note: stop?.note || (groups.length ? `한 거래로 보이는 묶음 ${groups.length}개를 찾았습니다.` : "한 거래로 묶을 서류를 찾지 못했습니다.") };
}
