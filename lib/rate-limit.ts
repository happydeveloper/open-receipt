// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 에이전트 엔드포인트 호출 제한. 주소가 열려 있어 누구나 부를 수 있으므로,
 * 한 곳에서 몰아 부르거나 전체 호출이 하루 한도를 넘으면 429로 거절한다.
 *
 * 횟수는 서버 인스턴스의 메모리에 둔다. 인스턴스가 여러 개 뜨거나 새로 뜨면 따로 세므로
 * 정확한 상한이 아니라 크레딧이 한꺼번에 소진되는 일을 막는 안전장치다.
 */
export interface LimitRule {
  /** 한 주소가 짧은 시간에 부를 수 있는 횟수 */
  burst: number;
  burstMs: number;
  /** 한 주소가 하루에 부를 수 있는 횟수 */
  daily: number;
  /** 모든 주소를 합친 하루 횟수 */
  globalDaily: number;
}
// 지출 한 건에 run이 2~3번(질문에 답하면 새 run), 여러 장 올리기는 30장까지 연달아 부른다.
export const AGENT_LIMIT: LimitRule = { burst: 80, burstMs: 10 * 60_000, daily: 400, globalDaily: 3000 };

const DAY = 24 * 60 * 60_000;
export interface LimitResult {
  ok: boolean;
  /** 거절했을 때 다시 시도할 수 있을 때까지 남은 초 */
  retryAfter: number;
  reason?: "burst" | "daily" | "global";
}

export function createLimiter(rule: LimitRule = AGENT_LIMIT, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let all: number[] = [];
  const wait = (times: number[], windowMs: number, t: number) => Math.max(1, Math.ceil((times[0] + windowMs - t) / 1000));
  return {
    check(key: string): LimitResult {
      const t = now();
      all = all.filter((x) => t - x < DAY);
      const mine = (hits.get(key) ?? []).filter((x) => t - x < DAY);
      const recent = mine.filter((x) => t - x < rule.burstMs);
      let res: LimitResult = { ok: true, retryAfter: 0 };
      if (all.length >= rule.globalDaily) res = { ok: false, retryAfter: wait(all, DAY, t), reason: "global" };
      else if (mine.length >= rule.daily) res = { ok: false, retryAfter: wait(mine, DAY, t), reason: "daily" };
      else if (recent.length >= rule.burst) res = { ok: false, retryAfter: wait(recent, rule.burstMs, t), reason: "burst" };
      if (res.ok) {
        mine.push(t);
        all.push(t);
      }
      if (mine.length) hits.set(key, mine);
      else hits.delete(key);
      // 오래 쌓이지 않게 가끔 비운다.
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < DAY)) hits.delete(k);
      return res;
    },
  };
}

/** 요청을 보낸 주소. Vercel은 x-forwarded-for의 첫 값에 실제 주소를 넣는다. */
export function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

const shared = createLimiter();
/** 제한에 걸렸으면 429 응답을, 아니면 null을 돌려준다. */
export function limitAgent(req: Request, cors: Record<string, string>, limiter = shared): Response | null {
  const r = limiter.check(clientKey(req));
  if (r.ok) return null;
  const error = r.reason === "global"
    ? "오늘 에이전트 사용량이 한도에 이르렀습니다. 내일 다시 시도하거나 직접 입력으로 계속해 주세요."
    : "요청이 많아 잠시 쉬고 있습니다. 조금 뒤 다시 시도하거나 직접 입력으로 계속해 주세요.";
  return new Response(JSON.stringify({ error, retryAfter: r.retryAfter }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(r.retryAfter), ...cors } });
}
