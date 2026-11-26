// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 오류 보고에서 민감한 것을 지운다.
 *
 * 열린영수증의 열쇠는 주소의 # 뒤에 있고(초대 링크, 후원자 링크, 공유 링크), 화면에는 영수증 내용이 있다.
 * 오류를 밖으로 보낼 때 이런 것이 딸려 나가지 않게, 보내기 직전에 모든 글을 이 함수에 통과시킨다.
 */
const MAX = 2000;
/** 글 한 토막을 안전하게 만든다. */
export function scrubText(input: unknown, max = MAX): string {
  let s = typeof input === "string" ? input : input == null ? "" : String(input);
  if (s.length > max * 4) s = s.slice(0, max * 4);
  return s
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[사진]") // 사진 내용
    .replace(/#[^\s"'<>)]*/g, "#[가림]") // 주소의 # 뒤 (열쇠가 들어 있다)
    .replace(/\?[^\s"'<>)#]*/g, "?[가림]") // 주소의 ? 뒤
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[메일]")
    .replace(/[A-Za-z0-9_-]{20,}/g, "[값]") // 열쇠·주소·증표처럼 긴 값
    .replace(/\d[\d\s,-]{5,}\d/g, "[숫자]") // 카드·계좌·전화번호, 큰 금액
    .slice(0, max);
}
/** 주소에서 경로만 남긴다. */
export function scrubUrl(url: unknown): string {
  const s = typeof url === "string" ? url : "";
  if (!s) return "";
  try {
    const u = new URL(s, "http://x");
    const path = u.pathname.replace(/[A-Za-z0-9_-]{20,}/g, "[값]");
    return /^https?:/.test(s) ? `${u.origin}${path}` : path;
  } catch {
    return scrubText(s, 200);
  }
}
/** 값 안의 글을 모두 지워 가며 복사한다 (깊이 제한). */
function scrubDeep(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return scrubText(v, 500);
  if (v == null || typeof v !== "object") return v;
  if (depth > 3) return "[생략]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrubDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) out[k] = /url|href|to|from/i.test(k) && typeof x === "string" ? scrubUrl(x) : scrubDeep(x, depth + 1);
  return out;
}

/**
 * 오류 수집 도구로 보내는 사건(event)을 정리한다. 모양은 Sentry의 event를 따르지만 그 꾸러미에 기대지 않는다.
 * 사용자 정보, 쿠키, 헤더, 요청 본문은 통째로 버리고, 남는 글은 모두 scrubText를 거친다.
 */
export function scrubEvent<T extends Record<string, any>>(event: T): T {
  const e: Record<string, any> = event;
  delete e.user;
  if (e.request) e.request = { url: scrubUrl(e.request.url), method: e.request.method };
  if (typeof e.message === "string") e.message = scrubText(e.message);
  if (typeof e.transaction === "string") e.transaction = scrubUrl(e.transaction);
  for (const x of e.exception?.values ?? []) {
    if (typeof x.value === "string") x.value = scrubText(x.value);
    for (const f of x.stacktrace?.frames ?? []) {
      delete f.vars; // 변수 값에는 기록 내용이 들어 있을 수 있다
      if (typeof f.abs_path === "string") f.abs_path = scrubUrl(f.abs_path);
    }
  }
  if (Array.isArray(e.breadcrumbs)) e.breadcrumbs = e.breadcrumbs.map(scrubCrumb).filter(Boolean);
  if (e.extra) e.extra = scrubDeep(e.extra);
  if (e.contexts) for (const k of Object.keys(e.contexts)) if (!["browser", "os", "device", "runtime", "trace", "react", "culture"].includes(k)) delete e.contexts[k];
  return event;
}
/** 오류 직전의 행동 기록(breadcrumb). 화면에 적은 글(입력, 콘솔)은 남기지 않는다. */
export function scrubCrumb<T extends Record<string, any>>(crumb: T): T | null {
  const c: Record<string, any> = crumb;
  if (c.category === "console") return null; // 콘솔에는 무엇이든 찍힐 수 있다
  if (typeof c.category === "string" && c.category.startsWith("ui.")) c.message = ""; // 누른 단추의 이름표에 기록 내용이 들어 있을 수 있다
  if (typeof c.message === "string") c.message = scrubText(c.message, 300);
  if (c.data) c.data = scrubDeep(c.data);
  return crumb;
}
