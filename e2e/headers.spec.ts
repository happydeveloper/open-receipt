// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 보안 헤더(CSP)가 화면을 막지 않는지: 주요 페이지에서 정책 위반이 한 건도 나오지 않아야 한다.
 * PDF 올리기처럼 작업자 스크립트를 쓰는 기능은 다른 흐름 테스트를 운영 빌드에 대고 돌려 확인한다
 * (BASE_URL=http://localhost:포트, next build 뒤 next start).
 */
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, locale: "ko-KR" });

test("보안 헤더: 주요 화면에서 내용 보안 정책 위반이 없다", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => { if (/Content Security Policy/i.test(e.message)) violations.push(e.message.slice(0, 200)); });

  const res = await page.goto("/");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
  for (const path of ["/guide", "/developers", "/v", "/r", "/app"]) { await page.goto(path); await page.waitForLoadState("networkidle"); }

  // 앱: 데모 불러오기, 결산보고서
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.locator("main")).toContainText("결산보고서");
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  expect(violations).toEqual([]);
});
