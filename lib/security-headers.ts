// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 모든 응답에 붙이는 보안 헤더. next.config.ts가 쓴다.
 *
 * 이 앱은 열쇠를 주소의 # 뒤에 담고(초대 링크, 후원자 링크), 화면에 영수증을 띄운다.
 * 그래서 가장 지키려는 것은 "화면에 있는 것이 다른 곳으로 새지 않는 것"이다:
 *  - 내용 보안 정책(CSP)의 connect-src로, 페이지가 자료를 보낼 수 있는 곳을 이 서버(와 오류 수집 주소)로 좁힌다.
 *  - 다른 사이트가 이 앱을 틀(iframe)에 끼워 넣지 못하게 한다.
 *  - 바깥 링크를 눌러도 어느 주소에서 왔는지 알리지 않는다.
 *
 * 한계: Next.js가 페이지에 직접 써넣는 스크립트 때문에 script-src에 'unsafe-inline'이 남아 있다.
 * 페이지에 스크립트를 심는 공격 자체를 CSP로 막지는 못하고, 심더라도 자료를 밖으로 보내기 어렵게 할 뿐이다.
 */
export interface HeaderOptions {
  /** 개발 서버인지. 개발 서버는 화면을 바로 고쳐 주는 기능에 eval과 웹소켓을 쓴다 */
  dev?: boolean;
  /** 오류 수집 도구처럼 페이지가 자료를 보내야 하는 다른 주소 (예: https://errors.example.com) */
  connect?: string[];
  /** 스크립트를 받아 와야 하는 다른 주소. 되도록 비워 둔다 */
  scripts?: string[];
}
/** 주소에서 출처(https://호스트)만 뽑는다. 주소가 아니면 빈 글. */
export function originOf(url: string | undefined): string {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" ? u.origin : "";
  } catch {
    return "";
  }
}
export function contentSecurityPolicy({ dev = false, connect = [], scripts = [] }: HeaderOptions = {}): string {
  const extra = connect.filter(Boolean);
  const rules: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'wasm-unsafe-eval': PDF를 그림으로 바꾸는 부품(PDF.js)이 일부 그림을 풀 때 쓴다
    "script-src": ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : []), ...scripts.filter(Boolean)],
    "style-src": ["'self'", "'unsafe-inline'"],
    // data:, blob: 기기에서 가리고 줄인 영수증 사진
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "media-src": ["'self'"],
    "connect-src": ["'self'", ...extra, ...(dev ? ["ws:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(rules).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ") + (dev ? "" : "; upgrade-insecure-requests");
}
export function securityHeaders(opts: HeaderOptions = {}): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // 쓰지 않는 기기 기능은 꺼 둔다. 영수증 촬영은 파일 선택 창이 하므로 카메라 권한이 필요 없다.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
  ];
}
