// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Liner Platform API 호출 (Model API, Search API).
 *
 * - 서버에서만 import한다. LINER_API_KEY를 읽는 곳은 이 파일 하나뿐이다(tests/proxy.test.ts가 확인한다).
 * - 429와 5xx는 한 번만 다시 시도하고, 30초 안에 응답이 없으면 끊는다.
 * - 오류는 LinerError로 던지며, 사용자에게 보여 줄 문장(userMessage)을 함께 담는다.
 * - fetch, 키, 대기 함수를 LinerDeps로 받아서 테스트에서 가짜로 바꿔 끼울 수 있다.
 */
export const MODEL_URL = "https://platform.liner.com/api/v1/chat/completions";
export const SEARCH_URL = "https://platform.liner.com/api/v1/tools/search/web";
export const DEFAULT_MODEL = "liner-gpt-router";
export const TIMEOUT_MS = 30_000;

/** Liner 호출 실패. code는 내부 구분용, userMessage는 화면에 그대로 보여 줄 문장이다. */
export class LinerError extends Error {
  constructor(
    public status: number,
    public code: string,
    public userMessage: string,
  ) {
    super(`${status} ${code}`);
  }
}

/** 바깥과 닿는 부분. 테스트에서는 fetch와 sleep을 가짜로 넣는다. */
export interface LinerDeps {
  fetch: typeof fetch;
  apiKey: string;
  model: string;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
}

export function defaultDeps(): LinerDeps {
  return {
    fetch: globalThis.fetch,
    apiKey: process.env.LINER_API_KEY ?? "",
    model: process.env.LINER_MODEL || DEFAULT_MODEL,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    timeoutMs: TIMEOUT_MS,
  };
}

const MANUAL = " 직접 입력으로 계속할 수 있습니다.";
/** 오류 종류별 안내 문장. 어떤 오류든 "직접 입력으로 계속"할 수 있다고 알려 준다. */
export function userMessageFor(status: number, code = ""): string {
  if (code === "no_key") return "서버에 Liner API 키가 설정되지 않았습니다." + MANUAL;
  if (code === "timeout") return "응답이 30초 넘게 걸려 중단했습니다." + MANUAL;
  if (status === 401) return "Liner API 키를 확인해 주세요." + MANUAL;
  if (status === 402) return "Liner 크레딧이 부족합니다." + MANUAL;
  if (status === 429) return "요청이 많습니다. 잠시 후 다시 시도해 주세요." + MANUAL;
  return "AI 서버에 일시적인 문제가 있습니다." + MANUAL;
}

/** POST 한 번. 429와 5xx는 한 번만 다시 시도한다 (attempt 0에서만). */
async function request(url: string, headers: Record<string, string>, body: unknown, deps: LinerDeps): Promise<any> {
  if (!deps.apiKey) throw new LinerError(500, "no_key", userMessageFor(500, "no_key"));
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs);
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err: any) {
      const timedOut = ctrl.signal.aborted || err?.name === "AbortError";
      throw new LinerError(504, timedOut ? "timeout" : "network", userMessageFor(504, timedOut ? "timeout" : ""));
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429 && attempt === 0) {
      const ra = Number(res.headers.get("retry-after"));
      await deps.sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra : 1, 10) * 1000);
      continue;
    }
    // 일시적인 서버 오류는 1초 뒤 한 번만 다시 시도한다.
    if (res.status >= 500 && attempt === 0) {
      await deps.sleep(1000);
      continue;
    }
    if (!res.ok) {
      let code = "";
      try {
        const j = await res.json();
        code = String(j?.error?.code ?? j?.error?.type ?? "");
      } catch {}
      throw new LinerError(res.status, code || "http_error", userMessageFor(res.status));
    }
    try {
      return await res.json();
    } catch {
      throw new LinerError(502, "bad_json", userMessageFor(502));
    }
  }
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface AssistantTurn {
  content: string | null;
  toolCalls: ToolCall[];
}

/** Liner Model API 도구 호출. 모델이 다음에 쓸 도구를 스스로 고른다. */
export async function chatWithTools(
  args: { messages: unknown[]; tools: object[]; maxTokens?: number },
  deps: LinerDeps = defaultDeps(),
): Promise<AssistantTurn> {
  const json = await request(
    MODEL_URL,
    { Authorization: `Bearer ${deps.apiKey}` },
    {
      model: deps.model,
      messages: args.messages,
      tools: args.tools,
      tool_choice: "required",
      reasoning_effort: "low",
      max_completion_tokens: args.maxTokens ?? 1500,
    },
    deps,
  );
  const m = json?.choices?.[0]?.message;
  const calls = Array.isArray(m?.tool_calls) ? m.tool_calls : [];
  return {
    content: typeof m?.content === "string" ? m.content : null,
    toolCalls: calls
      .filter((c: any) => c && typeof c.id === "string" && typeof c.function?.name === "string")
      .map((c: any) => ({ id: c.id, type: "function" as const, function: { name: c.function.name, arguments: String(c.function.arguments ?? "{}") } })),
  };
}

export interface SearchResult {
  title?: string;
  url?: string;
  hostname?: string;
  description?: string;
  date?: string | null;
}

/** Liner Search API (web). */
export async function searchWeb(query: string, deps: LinerDeps = defaultDeps(), maxResults = 8): Promise<SearchResult[]> {
  const json = await request(
    SEARCH_URL,
    { "x-api-key": deps.apiKey },
    { query, max_results: maxResults, include_knowledge: false },
    deps,
  );
  return Array.isArray(json?.results) ? json.results : [];
}
