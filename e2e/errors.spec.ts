// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 화면이 깨졌을 때.
 *
 *  1. 화면을 그리다 오류가 나면 흰 화면이 아니라 오류 화면이 나온다. 기록이 그대로라는 안내가 있다.
 *  2. 오류 화면에서 이 기기의 기록을 백업 파일로 내려받을 수 있다 (앱이 열리지 않아도 기록을 꺼낸다).
 *  3. "다시 시도"를 누르면 원래 화면으로 돌아온다.
 *  4. 없는 주소에는 안내 페이지가 나온다.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, locale: "ko-KR" });

test("오류 화면: 기록이 그대로라고 알리고, 백업을 내려받고, 다시 시도할 수 있다", async ({ page }) => {
  // 이 기기에 기록을 만들어 둔다
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await expect(page.getByText("교통비").first()).toBeVisible();

  await page.goto("/debug/error");
  await page.getByRole("button", { name: "일부러 오류 내기" }).click();
  const screen = page.getByTestId("error-screen");
  await expect(screen).toContainText("화면을 여는 중 문제가 생겼습니다");
  await expect(screen).toContainText("기록은 이 기기에 그대로 있습니다");
  await expect(screen).toContainText(/영수증과 기록 내용은 (어디로도 )?보내지 않습니다\./); // 오류 수집이 켜진 배포본에서는 "기록됩니다" 문구가 함께 나온다

  // 비상 백업: 설정 화면의 백업과 같은 파일이 나온다
  const [file] = await Promise.all([page.waitForEvent("download"), screen.getByRole("button", { name: "기록 백업 내려받기" }).click()]);
  expect(file.suggestedFilename()).toMatch(/^열린영수증_백업_\d{4}-\d{2}-\d{2}\.json$/);
  const back = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(JSON.stringify(back)).toContain("교통비");
  await expect(screen).toContainText("백업 파일을 내려받았습니다.");

  // 다시 시도하면 시험 페이지로 돌아온다
  await screen.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("button", { name: "일부러 오류 내기" })).toBeVisible();

  // 기록은 그대로다
  await page.goto("/app");
  await expect(page.getByText("교통비").first()).toBeVisible();
});

test("없는 주소에는 안내 페이지가 나온다", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toContainText("찾을 수 없는 페이지입니다");
  await page.getByRole("link", { name: "앱 열기" }).click();
  await expect(page).toHaveURL(/\/app$/);
});
