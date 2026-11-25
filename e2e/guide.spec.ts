// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 사용 안내 페이지: 세 역할의 단계가 모두 사진과 함께 나오고, 소개 페이지에서 찾아갈 수 있다.
 */
import { expect, test } from "@playwright/test";

test("사용 안내: 등록자·승인자·후원자 단계가 화면 사진과 함께 나오고, 소개 페이지에서 이어진다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "승인자 안내" }).click();
  await expect(page).toHaveURL(/\/guide#approver$/);
  await expect(page.getByRole("heading", { name: "화면을 보고 그대로 따라 하세요" })).toBeVisible();
  for (const name of ["등록자는 이렇게 합니다", "승인자는 이렇게 합니다", "후원자는 이렇게 합니다"]) await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByTestId("guide-roles").getByRole("link")).toHaveCount(3);
  await expect(page.getByTestId("guide-step")).toHaveCount(23);
  // 사진이 하나도 깨지지 않았다
  const images = page.getByTestId("guide-step").locator("img");
  await expect(images).toHaveCount(23);
  for (const src of await images.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).getAttribute("src")!))) {
    expect((await page.request.get(src)).status(), src).toBe(200);
  }
  for (const alt of await images.evaluateAll((els) => els.map((el) => (el as HTMLImageElement).alt))) expect(alt.length).toBeGreaterThan(10);
  // 역할 카드로 그 역할의 안내로 간다
  await page.getByTestId("guide-roles").getByRole("link", { name: /후원자/ }).click();
  await expect(page).toHaveURL(/#sponsor$/);
  await expect(page.getByRole("heading", { name: "링크를 열면 결산보고서가 보입니다" })).toBeInViewport();
});
