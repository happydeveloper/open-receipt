// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

// 실제 영수증 사진으로 시나리오를 돌린다. 사진은 저장소에 넣지 않고 경로로 받는다.
//   LIVE=1 SAMPLE_RECEIPT=/path/to/receipt.jpg SAMPLE_AMOUNT=11,400 SAMPLE_DATE=7/13 npx playwright test e2e/sample.spec.ts
const photo = process.env.SAMPLE_RECEIPT;
test.skip(!process.env.LIVE || !photo, "LIVE=1과 SAMPLE_RECEIPT가 있을 때만 실행");

test("실제 영수증 사진: 올리기 → 가림 → 에이전트 → 확정 → 결산보고서", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.locator("#file").setInputFiles(photo!);
  await expect(page.getByAltText("올린 영수증 미리보기")).toBeVisible();
  await page.locator("#memo").fill("워크숍 간식 샀어요");
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  // 대표자 이름 줄(위쪽)과 계산원 이름(아래쪽)을 가린다
  const box = (await page.locator(".maskwrap").boundingBox())!;
  for (const [x0, y0, x1, y1] of [[0.15, 0.185, 0.42, 0.21], [0.62, 0.715, 0.80, 0.745]]) {
    await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 4 });
    await page.mouse.up();
  }
  await expect(page.getByText("가린 상자 2개")).toBeVisible();
  await page.screenshot({ path: "test-results/sample-masked.png", fullPage: true });
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();

  const confirm = page.getByRole("button", { name: "내용 확정" });
  const answer = page.getByRole("button", { name: "답하고 계속" });
  for (let round = 0; round < 3; round++) {
    await expect(confirm.or(answer).or(page.locator('.astryx-banner[data-status="error"]'))).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.astryx-banner[data-status="error"]')).toHaveCount(0);
    if (await confirm.isVisible()) break;
    console.log(`질문 ${round + 1}:`, (await page.locator('[data-testid="question"] h3').allInnerTexts()).join(" | "));
    const projectBtn = page.getByRole("button", { name: "자원봉사자 워크숍" });
    if (await projectBtn.count()) await projectBtn.click();
    if (await page.locator("#q-purpose").count()) await page.locator("#q-purpose").fill("워크숍 참가자 간식 구매");
    if (await page.locator("#q-budget").count()) await page.locator("#q-budget").fill("회의·행사비");
    if (await page.locator("#q-payer").count()) {
      await page.locator("#q-payer").fill("김○○");
      await page.getByRole("radio", { name: "환급 필요" }).click();
    }
    await answer.click();
  }
  await expect(confirm).toBeVisible();
  const log = await page.getByLabel("에이전트가 한 일").locator("li").allInnerTexts();
  console.log("에이전트가 한 일:\n  " + log.map((l) => l.replace(/\n/g, " — ")).join("\n  "));
  const bundle = (await page.getByTestId("bundle").innerText()).replace(/\n/g, " ").replace(/\s{2,}/g, " ");
  console.log("증빙 묶음:", bundle);
  console.log("요약:", await page.locator("#f-summary").inputValue());
  const checks = await page.locator('[data-testid="check"]').allInnerTexts();
  console.log("확인할 자료:", checks.length ? "\n  " + checks.join("\n  ") : "(없음)");
  await page.screenshot({ path: "test-results/sample-bundle.png", fullPage: true });

  if (process.env.SAMPLE_AMOUNT) expect(bundle).toContain(`${process.env.SAMPLE_AMOUNT}원`);
  if (process.env.SAMPLE_DATE) expect(bundle).toContain(process.env.SAMPLE_DATE);
  if (process.env.SAMPLE_PAYMENT) expect(bundle).toContain(process.env.SAMPLE_PAYMENT);

  await confirm.click();
  await expect(page.getByTestId("saved-line")).toBeVisible();
  console.log("저장:", (await page.getByTestId("saved-line").innerText()).replace(/\n/g, " "));
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "결산보고서 보기" }).click();
  console.log("결산 합계:", await page.locator("#report-total").innerText());
  await page.screenshot({ path: "test-results/sample-report.png", fullPage: true });
});
