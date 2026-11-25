// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 실제 Liner로 같은 거래 묶기. LIVE=1일 때만 실행 (크레딧 사용).
 *   LIVE=1 npx playwright test e2e/group-live.spec.ts
 * 가상 서류 네 장을 그려서 올린다: 같은 거래의 카드영수증·거래명세서·주문 화면, 그리고 다른 거래의 간이영수증.
 * 가맹점 표기와 날짜를 일부러 다르게 했다. 모델이 세 장만 묶고 네 번째는 남겨 두는지 본다.
 */
import { expect, test } from "@playwright/test";
import { draw, sheets } from "./papers";

test.skip(!process.env.LIVE, "LIVE=1일 때만 실행");

test("실제 Liner: 따로 올린 서류 가운데 같은 거래 세 장을 찾아 제안하고, 합치면 합계가 바로잡힌다", async ({ page, browser }) => {
  test.setTimeout(420_000);
  const files = [];
  for (const [name, html] of sheets) files.push({ name, mimeType: "image/png", buffer: await draw(browser, html) });
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "영수증 여러 장 올리기" }).click();
  await page.locator("#bulk-files").setInputFiles(files);
  await page.locator("#bulk-memo").fill("워크숍 다과와 현수막");
  await page.getByRole("button", { name: "4장 에이전트에게 맡기기" }).click();
  await expect(page.getByText("4장을 초안으로 정리했습니다.")).toBeVisible({ timeout: 300_000 });
  console.log("읽은 결과:\n  " + (await page.getByTestId("bulk-list").innerText()).replace(/\n+/g, " | "));

  // 묶음 에이전트가 끝날 때까지 기다린다
  const card = page.getByTestId("group-card");
  await expect(card.getByRole("button", { name: "다시 찾기" })).toBeVisible({ timeout: 120_000 });
  console.log("묶음 제안:\n  " + (await card.innerText()).replace(/\n+/g, " | "));
  const group = page.getByTestId("group");
  await expect(group).toHaveCount(1);
  await expect(group).toContainText("한 거래로 보이는 서류 3장");
  await expect(group).not.toContainText("18,000원");
  await group.getByRole("button", { name: "한 건으로 합치기" }).click();
  await expect(page.locator("main")).toContainText("서류 3장을 한 건으로 합쳤습니다.");

  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "결산보고서" }).click();
  console.log("결산 합계:", await page.locator("#report-total").innerText());
  await expect(page.locator("#report-total")).toHaveText("74,900원"); // 데모 30,500 + 다과 26,400 + 현수막 18,000
  await expect(page.getByTestId("receipt")).toHaveCount(4);
});
