// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 두 사람이 같은 지출의 서로 다른 칸을 동시에 고쳐도 둘 다 남는다.
 *
 *  1. 총무가 단체 공간을 만들고, 승인자가 다른 기기에서 참여한다.
 *  2. 두 기기 모두 연결이 끊긴 상태에서, 총무는 교통비의 목적을, 승인자는 같은 기록의 예산 항목을 고친다.
 *  3. 다시 연결해 차례로 동기화한다.
 *  4. 두 기기 모두 고친 목적과 고친 예산 항목을 함께 본다. 예전에는 나중에 고친 쪽만 남았다.
 *  5. 둘 다 고친 금액은 나중 값이 남고, 변경 이력에 누가 무엇을 고쳤는지와 덮인 값이 남는다.
 */
import { expect, test, type Page } from "@playwright/test";

const mobile = { viewport: { width: 390, height: 844 }, locale: "ko-KR" };
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 60_000 }).toBeGreaterThan(before);
}
/** 교통비 기록을 열어 몇 칸을 고치고 확정한다. */
async function editFields(p: Page, values: Record<string, string>) {
  await p.getByText("교통비").first().click();
  await p.getByRole("button", { name: "수정", exact: true }).click();
  for (const [field, value] of Object.entries(values)) await p.locator(field).fill(value);
  await p.getByRole("button", { name: "내용 확정" }).click();
  await p.getByRole("button", { name: "검토 목록 보기" }).click();
  await p.getByRole("button", { name: "지출 목록으로" }).click();
}

test("함께 고치기: 두 기기가 같은 지출의 다른 칸을 고쳐도 양쪽 수정이 모두 남는다", async ({ page, browser }) => {
  test.setTimeout(180_000);
  // 1. 단체 공간과 두 기기
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  const invite = await page.locator("#invite-link").inputValue();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  const otherCtx = await browser.newContext(mobile);
  const other = await otherCtx.newPage();
  await other.goto(invite);
  await other.locator("#j-name").fill("박승인");
  await other.getByRole("radio", { name: "승인하는 사람" }).click();
  await other.getByRole("button", { name: "참여하기" }).click();
  await expect(other.getByText("교통비")).toBeVisible({ timeout: 60_000 });
  await syncDevice(other);

  // 2. 둘 다 연결이 끊긴 채 고친다
  await page.context().setOffline(true);
  await otherCtx.setOffline(true);
  // 목적과 예산 항목은 서로 다른 칸이고, 금액은 둘 다 고친다 (승인자가 나중)
  await editFields(page, { "#f-purpose": "강사 왕복 교통비 (총무가 고침)", "#f-amount": "13000" });
  await other.waitForTimeout(1100); // 두 수정의 시각이 겹치지 않게
  await editFields(other, { "#f-budgetCategory": "강사비 (승인자가 고침)", "#f-amount": "14000" });

  // 3. 다시 연결해 차례로 동기화한다
  await page.context().setOffline(false);
  await otherCtx.setOffline(false);
  await syncDevice(other);
  await syncDevice(page);
  await syncDevice(other);

  // 4. 두 기기 모두 양쪽 수정을 본다
  for (const p of [page, other]) {
    await p.getByText("교통비").first().click();
    const detail = p.getByTestId("detail");
    await expect(detail).toContainText("강사 왕복 교통비 (총무가 고침)");
    await expect(detail).toContainText("강사비 (승인자가 고침)");
    // 합친 내용에도 서명이 있다
    await expect(detail).not.toContainText("지금 내용에 서명한 기기가 없습니다");
    // 같은 칸(금액)은 나중에 고친 값이 남고, 누가 무엇을 고쳤는지와 덮인 값이 이력에 남는다
    await expect(detail).toContainText("14,000원");
    const history = p.getByTestId("history");
    await expect(history).toContainText("목적: 강사 교통비 지급 → 강사 왕복 교통비 (총무가 고침)");
    await expect(history).toContainText("금액: 12,500원 → 13,000원");
    await expect(history).toContainText("금액: 12,500원 → 14,000원");
    await expect(history).toContainText("금액: 두 기기에서 함께 고쳐 나중에 고친 값(14,000원)을 남겼습니다. 덮인 값: 13,000원");
    await p.getByRole("button", { name: "지출 목록으로" }).click();
  }
});
