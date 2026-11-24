// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 소개 페이지에 넣을 화면 사진을 실제 앱에서 캡처한다. SHOTS_LANDING=1일 때만 실행.
 */
import { test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { askTurn, closeTurn, doneTurn, ndjson } from "./mocks";

// 랜딩페이지에 넣을 앱 화면을 캡처한다: SHOTS_LANDING=1 npx playwright test e2e/landing-shots.spec.ts
test.skip(!process.env.SHOTS_LANDING, "SHOTS_LANDING=1일 때만 실행");
test.use({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 });

const dir = "public/landing";
const shot = (page: Page, name: string) => page.screenshot({ path: `${dir}/${name}.png` });
const hideDevTools = (page: Page) => page.addStyleTag({ content: "nextjs-portal{display:none!important}" });

test("랜딩페이지용 화면 캡처", async ({ page, browser }) => {
  test.setTimeout(180_000);
  let n = 0;
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: n++ === 0 ? askTurn : doneTurn }));
  await page.route("**/api/agent/close", (route) => route.fulfill({ ...ndjson, body: closeTurn }));
  const png = readFileSync("public/demo-receipt.png");

  await page.goto("/app");
  await hideDevTools(page);
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();

  // 1. 여러 장 올리기
  await page.getByRole("button", { name: "영수증 여러 장 올리기" }).click();
  await page.locator("#bulk-files").setInputFiles(["다과_영수증.jpg", "현수막_영수증.jpg", "문구류_영수증.jpg", "교통비_이체확인.jpg"].map((name) => ({ name, mimeType: "image/png", buffer: png })));
  await page.locator("#bulk-memo").fill("11월 워크숍 준비물과 다과");
  await page.waitForTimeout(300);
  await shot(page, "1-upload");
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 2. 에이전트가 정리하고 모르는 것만 묻는다
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "가상 영수증 사용" }).click();
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  const box = (await page.locator(".maskwrap").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.9, { steps: 4 });
  await page.mouse.up();
  await page.locator(".maskwrap").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 330));
  await shot(page, "2-mask");
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.locator("#q-purpose").fill("워크숍 다과 구매");
  await page.locator("#q-payer").fill("김○○");
  await page.getByRole("radio", { name: "환급 필요" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "3-agent");

  // 3. 증빙 묶음
  await page.getByRole("button", { name: "답하고 계속" }).click();
  await page.locator("#f-summary").waitFor();
  await page.evaluate(() => window.scrollTo(0, 430));
  await shot(page, "4-bundle");
  await page.getByRole("button", { name: "내용 확정" }).click();

  // 4. 검토와 마감 점검
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "마감 점검 맡기기" }).click();
  await page.getByTestId("briefing").waitFor();
  await page.evaluate(() => window.scrollTo(0, 200));
  await shot(page, "5-review");

  // 5. 결산보고서와 영수증
  await page.getByRole("button", { name: "결산보고서 보기" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "6-report");
  await page.getByRole("heading", { name: "8. 영수증" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(300);
  await shot(page, "7-receipts");

  // 6. 후원자용 보기
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await page.locator("#invite-link").waitFor({ timeout: 30_000 });
  await page.getByRole("radio", { name: "열림" }).click();
  await page.locator("#viewer-link").waitFor();
  const viewerLink = await page.locator("#viewer-link").inputValue();
  await page.locator("#viewer-link").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -260));
  await shot(page, "8-share");
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "동기화", exact: true }).click();
  await page.waitForTimeout(4000);
  const sponsor = await (await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, locale: "ko-KR" })).newPage();
  await sponsor.goto(viewerLink);
  await sponsor.locator("#report-total").waitFor({ timeout: 30_000 });
  await hideDevTools(sponsor);
  await shot(sponsor, "9-sponsor");
});
