// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 환불을 기록하고, 목록에서 찾고, 예산과 견줘 본다.
 *
 *  1. 반품으로 돌려받은 돈을 "환불"로 기록한다. 합계에서 그만큼 빠진다.
 *  2. 목록에서 낱말, 금액, 상태로 찾는다. 찾은 건수와 합계가 함께 나온다.
 *  3. 설정에서 예산 항목마다 금액을 정하면, 결산보고서에 예산·집행률·남은 금액이 나온다.
 *  4. 내려받은 보고서 파일에도 같은 표가 들어 있다.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("장부 일: 환불 기록, 목록에서 찾기, 예산 대비 집행률", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await expect(page.getByText("30,500원").first()).toBeVisible();

  // 1. 환불을 기록한다 (영수증 없이 직접 입력)
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "영수증이 없어요" }).click();
  await page.locator("#alt-reason").fill("인쇄물 일부 반품, 카드 취소 내역으로 확인");
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.locator("#f-date").fill("2026-11-20");
  await page.getByRole("radio", { name: "환불 (되돌려 받음)" }).click();
  await page.locator("#f-amount").fill("5000");
  await expect(page.getByText("환불로 기록합니다. 합계에서 이 금액만큼 빠집니다.")).toBeVisible();
  await page.locator("#f-item").fill("인쇄물 반품");
  await page.locator("#f-pay").click();
  await page.getByRole("option", { name: "조직카드" }).click();
  await page.locator("#f-project").fill("자원봉사자 워크숍");
  await page.locator("#f-budgetCategory").fill("홍보·인쇄비");
  await page.getByRole("button", { name: "내용 확정" }).click();
  await expect(page.getByTestId("saved-line")).toContainText("인쇄물 반품 · -5,000원");
  await expect(page.getByTestId("saved-line")).toContainText("승인 대기");
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await expect(page.getByText("25,500원").first()).toBeVisible(); // 30,500 - 5,000
  await expect(page.locator("main")).toContainText("조직카드 · 환불");

  // 2. 찾기
  await page.locator("#search").fill("인쇄");
  await expect(page.getByTestId("filter-result")).toContainText("찾은 2건 · 13,000원 (전체 3건)");
  await expect(page.getByText("교통비")).toHaveCount(0);
  await page.locator("#search").fill("12,500");
  await expect(page.getByTestId("filter-result")).toContainText("찾은 1건 · 12,500원");
  await expect(page.getByText("교통비").first()).toBeVisible();
  await page.locator("#search").fill("환불");
  await expect(page.getByTestId("filter-result")).toContainText("찾은 1건 · -5,000원");
  await page.locator("#search").fill("없는 낱말");
  await expect(page.getByText("찾는 기록이 없습니다.")).toBeVisible();
  await page.getByRole("button", { name: "모두 보기" }).click();
  await page.locator("#filter-status").click();
  await page.getByRole("option", { name: "증빙 보완만" }).click();
  await expect(page.getByTestId("filter-result")).toContainText("찾은 1건 · 12,500원");
  await page.getByRole("button", { name: "모두 보기" }).click();
  await expect(page.getByTestId("filter-result")).toHaveCount(0);

  // 3. 예산을 정한다
  await page.getByRole("button", { name: "설정" }).click();
  const card = page.getByTestId("budget-card");
  await card.getByLabel("홍보·인쇄비 예산 (원)").fill("50000");
  await card.getByLabel("여비·교통비 예산 (원)").fill("10000");
  await card.getByLabel("예산 항목 추가").fill("회의·행사비");
  await card.getByRole("button", { name: "추가" }).click();
  await card.getByLabel("회의·행사비 예산 (원)").fill("100000");
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "결산보고서" }).click();
  const table = page.getByTestId("budget-table");
  await expect(table).toContainText("집행률");
  await expect(table.getByRole("row").filter({ hasText: "홍보·인쇄비" })).toContainText(/13,000원.*50,000원.*26%.*37,000원/);
  await expect(table.getByRole("row").filter({ hasText: "여비·교통비" })).toContainText(/12,500원.*10,000원.*125%.*-2,500원/); // 예산을 넘어도 숫자만 보인다
  await expect(table.getByRole("row").filter({ hasText: "회의·행사비" })).toContainText(/0건.*0원.*100,000원.*0%.*100,000원/);
  await expect(table.getByRole("row").filter({ hasText: "합계" })).toContainText(/25,500원.*160,000원.*16%.*134,500원/);
  await expect(page.locator("main")).not.toContainText(/초과|위반/);

  // 4. 내려받은 보고서에도 같은 표
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "보고서 내려받기" }).click()]);
  const html = await readFile((await dl.path())!, "utf8");
  for (const t of ["집행률", "남은 금액", "160,000원", "125%", "-5,000원"]) expect(html).toContain(t);

  // 새로 열어도 예산과 환불이 남아 있다
  await page.reload();
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.getByTestId("budget-table")).toContainText("160,000원");
  await expect(page.locator("#report-total")).toHaveText("25,500원");
});
