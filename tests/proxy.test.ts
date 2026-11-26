// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Liner 호출(헤더, 재시도, 시간 제한), 값 다듬기, API 키가 서버 밖으로 나가지 않는지,
 * 에이전트 엔드포인트 호출 제한.
 */
import { describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { chatWithTools, LinerError, MODEL_URL, SEARCH_URL, searchWeb, type LinerDeps } from "@/lib/liner";
import { normalizeAmount } from "@/lib/draft";
import { toSources } from "@/lib/guidelines";

const KEY = "test-key-not-real";
const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const toolTurn = () => jsonRes({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "finish", arguments: "{}" } }, { bad: true }] } }] });

function deps(handler: (url: string, init: RequestInit) => Response | Promise<Response>, over: Partial<LinerDeps> = {}) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const sleep = vi.fn(async () => {});
  const d: LinerDeps = {
    apiKey: KEY, model: "liner-gpt-router", sleep, timeoutMs: 30_000,
    fetch: (async (url: any, init: any) => {
      calls.push({ url: String(url), init, body: JSON.parse(init.body) });
      return handler(String(url), init);
    }) as typeof fetch,
    ...over,
  };
  return { d, calls, sleep };
}
const chat = (d: LinerDeps) => chatWithTools({ messages: [{ role: "user", content: "x" }], tools: [{ type: "function", function: { name: "finish" } }] }, d);

describe("Liner 호출", () => {
  it("T-22 Model API: Bearer 헤더, 도구 정의, tool_choice required", async () => {
    const { d, calls } = deps(() => toolTurn());
    const out = await chat(d);
    expect(out.toolCalls).toEqual([{ id: "c1", type: "function", function: { name: "finish", arguments: "{}" } }]);
    expect(calls[0].url).toBe(MODEL_URL);
    expect((calls[0].init.headers as any).Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0].body).toMatchObject({ model: "liner-gpt-router", tool_choice: "required" });
    expect(calls[0].body.tools).toHaveLength(1);
  });
  it("T-23 Search API: x-api-key 헤더, include_knowledge false, 결과 수 지정", async () => {
    const { d, calls } = deps(() => jsonRes({ results: [{ title: "a", url: "https://example.org/a" }] }));
    const out = await searchWeb("보조금 정산 증빙", d, 8);
    expect(out).toHaveLength(1);
    expect(calls[0].url).toBe(SEARCH_URL);
    expect((calls[0].init.headers as any)["x-api-key"]).toBe(KEY);
    expect((calls[0].init.headers as any).Authorization).toBeUndefined();
    expect(calls[0].body).toEqual({ query: "보조금 정산 증빙", max_results: 8, include_knowledge: false });
  });
  it("T-19 401·402·500은 서로 다른 안내, 5xx와 429는 1회 재시도", async () => {
    const msgs = new Set<string>();
    for (const status of [401, 402, 500]) {
      const { d, calls } = deps(() => jsonRes({ error: { code: "x" } }, status));
      const err = await chat(d).catch((e) => e);
      expect(err).toBeInstanceOf(LinerError);
      expect(err.status).toBe(status);
      expect(err.userMessage).toContain("직접 입력");
      msgs.add(err.userMessage);
      expect(calls).toHaveLength(status >= 500 ? 2 : 1);
    }
    let n = 0;
    const r = deps(() => (n++ === 0 ? jsonRes({ error: { code: "rate_limit_exceeded" } }, 429, { "retry-after": "2" }) : toolTurn()));
    await expect(chat(r.d)).resolves.toBeTruthy();
    expect(r.sleep).toHaveBeenCalledWith(2000);
    const always = deps(() => jsonRes({ error: {} }, 429, { "retry-after": "1" }));
    const err = await chat(always.d).catch((e) => e);
    expect(err.status).toBe(429);
    expect(always.calls).toHaveLength(2);
    msgs.add(err.userMessage);
    expect(msgs.size).toBe(4);
    let m = 0;
    const flaky = deps(() => (m++ === 0 ? jsonRes({}, 503) : toolTurn()));
    await expect(chat(flaky.d)).resolves.toBeTruthy();
  });
  it("T-20 응답이 없으면 시간 제한 후 중단하고 수동 입력 안내", async () => {
    const { d } = deps(
      (_u, init) => new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
      { timeoutMs: 20 },
    );
    await expect(chat(d)).rejects.toMatchObject({ code: "timeout", userMessage: expect.stringContaining("직접 입력") });
  });
  it("키가 없으면 호출하지 않고 안내", async () => {
    const { d, calls } = deps(() => toolTurn(), { apiKey: "" });
    await expect(chat(d)).rejects.toMatchObject({ code: "no_key" });
    expect(calls).toHaveLength(0);
  });
});

describe("값 다듬기", () => {
  it("T-07 금액 표기를 원 단위 정수로", () => {
    expect(normalizeAmount("26,400원")).toBe(26400);
    expect(normalizeAmount(26400.4)).toBe(26400);
    expect(normalizeAmount("무료")).toBeNull();
    expect(normalizeAmount(-5)).toBeNull();
  });
  it("T-12 검색 결과를 출처로: 주소 없는 것·겹치는 것 제외, 날짜 없으면 null", () => {
    const out = toSources([
      { title: "보조금 정산 안내", url: "https://example.go.kr/a", hostname: "example.go.kr", description: " 설명 ", date: "2026-04-15T00:00:00Z" },
      { title: "", url: "https://example.org/b" },
      { title: "중복", url: "https://example.go.kr/a" },
      { title: "주소 없음" },
      { title: "이상한 주소", url: "javascript:alert(1)" },
    ]);
    expect(out).toEqual([
      { title: "보조금 정산 안내", url: "https://example.go.kr/a", hostname: "example.go.kr", date: "2026-04-15", description: "설명" },
      { title: "example.org", url: "https://example.org/b", hostname: "example.org", date: null, description: "" },
    ]);
  });
});

describe("T-21 키 보안", () => {
  const root = path.resolve(__dirname, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  it("LINER_API_KEY는 lib/liner.ts에서만 읽고, 클라이언트 코드는 서버 모듈을 import하지 않는다", () => {
    const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "lib"))].filter((f) => /\.tsx?$/.test(f));
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (src.includes("process.env.LINER_API_KEY")) expect(path.relative(root, f)).toBe("lib/liner.ts");
      if (/^\s*["']use client["']/.test(src)) expect(src).not.toMatch(/lib\/(liner|agent|agui-server|sync-store)["']/);
      expect(src).not.toContain("NEXT_PUBLIC_LINER");
    }
  });
  it(".env 파일은 git에 올라가지 않는다", () => {
    expect(readFileSync(path.join(root, ".gitignore"), "utf8")).toMatch(/^\.env\.\*$/m);
    expect(execSync("git check-ignore .env.local || true", { cwd: root }).toString().trim()).toBe(".env.local");
    expect(execSync("git ls-files", { cwd: root }).toString()).not.toMatch(/^\.env(\.local)?$/m);
  });
});

import { clientKey, createLimiter, limitAgent, limitSync } from "@/lib/rate-limit";
describe("에이전트 호출 제한", () => {
  const rule = { burst: 3, burstMs: 60_000, daily: 5, globalDaily: 8 };
  it("한 주소가 짧은 시간에 몰아 부르면 거절하고, 시간이 지나면 다시 받는다", () => {
    let t = 1_000_000;
    const l = createLimiter(rule, () => t);
    expect([1, 2, 3].map(() => l.check("a").ok)).toEqual([true, true, true]);
    const no = l.check("a");
    expect(no).toMatchObject({ ok: false, reason: "burst", retryAfter: 60 });
    expect(l.check("b").ok).toBe(true); // 다른 주소는 영향이 없다
    t += 61_000;
    expect(l.check("a").ok).toBe(true);
  });
  it("한 주소의 하루 횟수와 전체 하루 횟수를 넘으면 거절한다", () => {
    let t = 1_000_000;
    const l = createLimiter(rule, () => t);
    for (let i = 0; i < 5; i++) { expect(l.check("a").ok).toBe(true); t += 61_000; }
    expect(l.check("a")).toMatchObject({ ok: false, reason: "daily" });
    for (let i = 0; i < 3; i++) expect(l.check(`c${i}`).ok).toBe(true);
    expect(l.check("new")).toMatchObject({ ok: false, reason: "global" });
    t += 24 * 60 * 60_000;
    expect(l.check("new").ok).toBe(true);
  });
  it("거절은 429와 Retry-After, CORS 헤더로 알린다", async () => {
    const l = createLimiter({ ...rule, burst: 1 }, () => 5_000);
    const req = new Request("https://x.test/api/agent/expense", { method: "POST", headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
    expect(clientKey(req)).toBe("203.0.113.7");
    expect(limitAgent(req, { "Access-Control-Allow-Origin": "*" }, l)).toBeNull();
    const res = limitAgent(req, { "Access-Control-Allow-Origin": "*" }, l)!;
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect((await res.json()).error).toContain("직접 입력");
  });
});

describe("동기화 주소 호출 제한", () => {
  const limiters = (now: () => number) => ({ read: createLimiter({ burst: 3, burstMs: 60_000, daily: 100, globalDaily: Infinity }, now), write: createLimiter({ burst: 2, burstMs: 60_000, daily: 100, globalDaily: Infinity }, now), miss: createLimiter({ burst: 2, burstMs: 60_000, daily: 100, globalDaily: Infinity }, now) });
  const from = (ip: string) => new Request("https://x.test/api/sync/abc", { headers: { "x-forwarded-for": ip } });
  const ok = async () => new Response("{}", { status: 200 });
  const none = async () => new Response("{}", { status: 404 });

  it("한 주소가 몰아 부르면 저장소를 부르지 않고 429로 거절하고, 다른 주소와 시간이 지난 뒤에는 받는다", async () => {
    let t = 1_000_000;
    const l = limiters(() => t);
    let calls = 0;
    const run = async () => { calls++; return ok(); };
    for (let i = 0; i < 3; i++) expect((await limitSync(from("1.1.1.1"), "read", run, { limiters: l })).status).toBe(200);
    const res = await limitSync(from("1.1.1.1"), "read", run, { limiters: l });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await res.json()).error).toContain("기록은 이 기기에 그대로");
    expect(calls).toBe(3); // 거절한 요청은 저장소에 닿지 않는다
    expect((await limitSync(from("2.2.2.2"), "read", run, { limiters: l })).status).toBe(200); // 다른 주소는 영향 없다
    expect((await limitSync(from("1.1.1.1"), "write", run, { limiters: l })).status).toBe(200); // 쓰기는 따로 센다
    t += 61_000;
    expect((await limitSync(from("1.1.1.1"), "read", run, { limiters: l })).status).toBe(200);
  });

  it("없는 공간을 되풀이해 찾으면 그 주소의 요청을 모두 쉬게 한다. 아직 없는 사진은 세지 않는다", async () => {
    let t = 1_000_000;
    const l = limiters(() => t);
    for (let i = 0; i < 5; i++) expect((await limitSync(from("3.3.3.3"), "read", none, { limiters: l, countMiss: false })).status).toBe(i < 3 ? 404 : 429); // 읽기 한도만 걸린다
    t += 61_000;
    expect((await limitSync(from("3.3.3.3"), "read", none, { limiters: l })).status).toBe(404);
    expect((await limitSync(from("3.3.3.3"), "read", none, { limiters: l })).status).toBe(404);
    // 두 번 헛짚은 뒤에는 있는 공간을 찾는 요청과 쓰기도 받지 않는다
    expect((await limitSync(from("3.3.3.3"), "read", ok, { limiters: l })).status).toBe(429);
    expect((await limitSync(from("3.3.3.3"), "write", ok, { limiters: l })).status).toBe(429);
    expect((await limitSync(from("4.4.4.4"), "read", ok, { limiters: l })).status).toBe(200);
  });
});
