// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 영수증과 거래명세서를 한 거래로 묶고, 그 사진이 결산보고서까지 가는지 확인한다.
 *
 *  1. 총무가 영수증을 올려 지출 한 건을 만든다 (에이전트는 가짜 응답).
 *  2. 같은 지출에 온라인몰 거래명세서를 붙인다. 지출은 여전히 한 건이다.
 *  3. 앱의 결산보고서에 사진 두 장이 나온다. 건수와 합계는 그대로다.
 *  4. 내려받은 결산보고서 파일 안에 사진 두 장이 들어 있다.
 *  5. 창을 새로 열어도 사진이 남아 있다.
 *  6. 단체 공간을 만들고 후원자용 보기를 열면, 후원자가 링크만으로 사진 두 장을 본다.
 *  7. 승인자 기기도 사진 두 장과 거래명세서 원본을 받는다.
 *  8. 거래명세서를 떼면 후원자 화면에서도 한 장으로 줄어든다.
 *  9. 기록을 지우면 서버에 올려 둔 사진(가린 사진, 원본, 후원자용)도 지워진다.
 *
 * 영수증과 거래명세서는 모두 가상 자료다.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { askTurn, doneTurn, ndjson } from "./mocks";

const mobile = { viewport: { width: 390, height: 844 }, locale: "ko-KR" };

/** 가상 온라인몰 거래명세서 그림을 만든다 (화면을 그려서 찍는다). */
async function statementPng(browser: Browser): Promise<Buffer> {
  const p = await (await browser.newContext({ viewport: { width: 420, height: 560 } })).newPage();
  await p.setContent(`<body style="font-family:sans-serif;padding:24px"><h2>거래명세서</h2><p>가상몰 (시연용 가상 자료)</p>
    <p>주문일 2026-11-18 · 주문번호 V-0000-0001</p><p>받는 분 김○○ · 서울시 ○○구 ○○로 1</p>
    <table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th>품목</th><th>수량</th><th>금액</th></tr>
    <tr><td>행사 다과 세트</td><td>4</td><td>26,400</td></tr><tr><td colspan="2">합계</td><td>26,400원</td></tr></table></body>`);
  const png = await p.screenshot();
  await p.context().close();
  return png;
}
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 60_000 }).toBeGreaterThan(before);
}
const srcs = (p: Page) => p.getByTestId("receipt").locator("img").evaluateAll((els) => els.map((el) => (el as HTMLImageElement).src));

test("한 거래로 묶기: 영수증에 거래명세서를 붙이면 한 건으로 남고, 사진이 결산보고서·내려받은 파일·후원자용 보기까지 간다", async ({ page, browser }) => {
  test.setTimeout(240_000);
  let n = 0;
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: n++ === 0 ? askTurn : doneTurn }));

  // 1. 영수증으로 지출 한 건을 만든다
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "가상 영수증 사용" }).click();
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "가림 상자 추가" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.locator("#q-purpose").fill("워크숍 다과 구매");
  await page.locator("#q-payer").fill("김○○");
  await page.getByRole("radio", { name: "환급 필요" }).click();
  await page.getByRole("button", { name: "답하고 계속" }).click();
  await page.getByRole("button", { name: "내용 확정" }).click();

  // 2. 같은 지출에 거래명세서를 붙인다
  await page.getByRole("button", { name: "거래명세서 등 자료 붙이기" }).click();
  await expect(page.getByRole("heading", { name: "자료 붙이기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "이 지출에 붙이기" })).toBeDisabled();
  await page.locator("#att-file").setInputFiles({ name: "statement.png", mimeType: "image/png", buffer: await statementPng(browser) });
  await page.getByRole("button", { name: "가림 상자 추가" }).click();
  await expect(page.getByText("가린 상자 1개")).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: "test-results/shot-attach.png", fullPage: true });
  await page.getByRole("button", { name: "이 지출에 붙이기" }).click();

  // 상세 화면: 한 지출에 사진 두 장
  await expect(page.getByRole("heading", { name: "지출 상세" })).toBeVisible();
  await expect(page.locator("main")).toContainText("거래명세서 자료를 이 지출에 붙였습니다.");
  await expect(page.getByTestId("detail")).toContainText("영수증 첨부 + 거래명세서");
  await expect(page.getByTestId("receipt")).toHaveCount(2);
  await expect(page.getByTestId("receipt").nth(1)).toContainText("2026-11-18 · 행사 다과 · 26,400원 · 거래명세서");
  await expect(page.getByTestId("attachments")).toContainText("거래명세서");
  if (process.env.SHOTS) await page.screenshot({ path: "test-results/shot-attach-detail.png", fullPage: true });

  // 3. 결산보고서: 건수와 합계는 그대로, 사진은 두 장
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.locator("#report-total")).toHaveText("56,900원");
  await expect(page.locator("main")).toContainText("3건");
  await expect(page.locator("main")).toContainText("영수증 첨부 + 거래명세서");
  await expect(page.getByTestId("receipt")).toHaveCount(2);
  await expect(page.getByAltText(/거래명세서 가린 영수증/)).toBeVisible();
  const shown = await srcs(page);
  expect(shown).toHaveLength(2);
  expect(shown[0]).not.toBe(shown[1]);
  for (const s of shown) expect(s).toMatch(/^data:image\/jpeg;base64,/);

  // 4. 내려받은 결산보고서 파일 안에 같은 사진 두 장이 들어 있다
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "보고서 내려받기" }).click()]);
  const html = await readFile((await download.path())!, "utf8");
  expect(html).toContain("8. 증빙 사진");
  expect(html.match(/<img /g)).toHaveLength(2);
  expect(html.match(/<section class="ev">/g)).toHaveLength(1);
  for (const s of shown) expect(html).toContain(s);
  expect(html).toContain("<figcaption>거래명세서</figcaption>");

  // 5. 창을 새로 열어도 사진이 남아 있다
  await page.reload();
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.getByTestId("receipt")).toHaveCount(2);
  expect(await srcs(page)).toEqual(shown);

  // 6. 단체 공간을 만들고 후원자용 보기를 연다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 30_000 });
  const invite = await page.locator("#invite-link").inputValue();
  await page.getByRole("radio", { name: "열림" }).click();
  await expect(page.locator("#viewer-link")).toHaveValue(/\/v#/);
  const viewerLink = await page.locator("#viewer-link").inputValue();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  // 결산보고서 화면에서도 사진이 보이는 링크를 바로 찾을 수 있다
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.locator("#report-viewer-link")).toHaveValue(viewerLink);

  const sponsor = await (await browser.newContext(mobile)).newPage();
  await sponsor.goto(viewerLink);
  await expect(sponsor.locator("#report-total")).toHaveText("56,900원", { timeout: 30_000 });
  await expect(sponsor.locator("main")).toContainText("영수증 첨부 + 거래명세서");
  await expect(sponsor.getByTestId("receipt")).toHaveCount(2);
  await expect(sponsor.getByTestId("receipt").locator("img")).toHaveCount(2, { timeout: 20_000 });
  expect(await srcs(sponsor)).toEqual(shown); // 총무가 보는 가린 사진과 같은 사진
  await expect(sponsor.getByRole("radio", { name: "원본" })).toHaveCount(0);

  // 7. 승인자 기기도 사진 두 장과 거래명세서 원본을 받는다
  const approver = await (await browser.newContext(mobile)).newPage();
  await approver.goto(invite);
  await approver.locator("#j-name").fill("박승인");
  await approver.getByRole("radio", { name: "승인하는 사람" }).click();
  await approver.getByRole("button", { name: "참여하기" }).click();
  await expect(approver.getByText("행사 다과")).toBeVisible({ timeout: 30_000 });
  await syncDevice(approver);
  await approver.getByRole("button", { name: "결산보고서" }).click();
  await expect(approver.getByTestId("receipt")).toHaveCount(2);
  expect(await srcs(approver)).toEqual(shown);
  const statement = approver.getByTestId("receipt").nth(1);
  await statement.getByRole("radio", { name: "원본" }).click();
  await expect(statement.getByAltText(/원본 영수증/)).toBeVisible({ timeout: 20_000 });
  expect(await statement.locator("img").getAttribute("src")).not.toBe(shown[1]);

  // 8. 거래명세서를 떼면 후원자 화면에서도 한 장으로 줄어든다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByText("행사 다과").first().click();
  await page.getByTestId("attachments").getByRole("button", { name: "떼기" }).click();
  await expect(page.getByTestId("receipt")).toHaveCount(1);
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  await sponsor.getByRole("button", { name: "새로 고침" }).click();
  await expect(sponsor.locator("#report-total")).toHaveText("56,900원", { timeout: 30_000 });
  await expect(sponsor.getByTestId("receipt")).toHaveCount(1);
  await expect(sponsor.getByTestId("receipt").locator("img")).toHaveCount(1, { timeout: 20_000 });

  // 9. 기록을 지우면 서버의 사진도 지워진다: 가린 사진, 원본, 후원자용 모두
  const spaceId = viewerLink.split("#")[1].split(".")[0];
  const eid = (await sponsor.evaluate(() => performance.getEntriesByType("resource").map((r) => r.name).filter((n) => n.includes("kind=view")).at(-1) ?? "")).match(/img\/([^?]+)\?/)?.[1];
  expect(eid).toBeTruthy();
  for (const kind of ["img", "orig", "view"]) expect((await page.request.get(`/api/sync/${spaceId}/img/${eid}?kind=${kind}`)).status(), kind).toBe(200);
  await page.getByText("행사 다과").first().click();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인" }).click();
  await syncDevice(page);
  // 배포 환경의 저장소는 지운 파일을 몇 초 동안 더 내줄 수 있어, 조금 기다리며 확인한다.
  for (const kind of ["img", "orig", "view"]) await expect.poll(async () => (await page.request.get(`/api/sync/${spaceId}/img/${eid}?kind=${kind}`)).status(), { message: kind, timeout: 120_000, intervals: [1000, 3000, 5000] }).toBe(404);
});
