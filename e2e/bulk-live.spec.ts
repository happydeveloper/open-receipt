// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

// 실제 Liner로 여러 장 올리기. LIVE=1일 때만 실행 (크레딧 사용).
//   LIVE=1 SAMPLE_RECEIPT=/path/to/receipt.jpg BASE_URL=... npx playwright test e2e/bulk-live.spec.ts
test.skip(!process.env.LIVE, "LIVE=1일 때만 실행");

test("실제 Liner: 영수증 여러 장을 한꺼번에 올려 초안으로 정리한다", async ({ page }) => {
  test.setTimeout(300_000);
  const files = ["public/demo-receipt.png", ...(process.env.SAMPLE_RECEIPT ? [process.env.SAMPLE_RECEIPT] : [])];
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "영수증 여러 장 올리기" }).click();
  await page.locator("#bulk-files").setInputFiles(files);
  await page.locator("#bulk-memo").fill("워크숍 간식과 준비물");
  await page.getByRole("button", { name: `${files.length}장 에이전트에게 맡기기` }).click();
  await expect(page.getByText(`${files.length}장을 초안으로 정리했습니다.`)).toBeVisible({ timeout: 240_000 });
  const rows = await page.getByTestId("bulk-list").locator("[class*=astryx]").allInnerTexts().catch(() => []);
  console.log("정리 결과:\n  " + (await page.getByTestId("bulk-list").innerText()).replace(/\n+/g, " | "));
  void rows;
  await expect(page.getByTestId("bulk-list")).toContainText("26,400원");
  if (process.env.SAMPLE_RECEIPT) await expect(page.getByTestId("bulk-list")).toContainText("11,400원");
  await expect(page.locator('.astryx-banner[data-status="error"]')).toHaveCount(0);

  await page.getByRole("button", { name: "지출 목록으로" }).click();
  const confirmAll = page.getByRole("button", { name: /초안 \d+건 한꺼번에 확정/ });
  await expect(confirmAll).toBeVisible();
  console.log("확정 버튼:", await confirmAll.innerText());
  await confirmAll.click();
  await page.getByRole("button", { name: "결산보고서" }).click();
  console.log("결산 합계:", await page.locator("#report-total").innerText());
  await expect(page.getByTestId("receipt")).toHaveCount(files.length);
});
