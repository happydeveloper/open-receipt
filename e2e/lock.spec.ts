// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 암호로 잠근 단체 공간.
 *
 *  1. 총무가 암호를 정해 단체 공간을 만든다. 너무 짧은 암호는 받지 않는다.
 *  2. 초대 링크에는 열쇠가 없다. 링크를 손에 넣은 사람이 틀린 암호를 넣으면 참여하지 못하고, 기록도 보이지 않는다.
 *  3. 맞는 암호를 넣으면 참여해 기록을 받는다.
 *  4. 암호 없이 만든 공간은 예전처럼 링크만으로 참여한다 (다른 테스트가 확인한다).
 */
import { expect, test } from "@playwright/test";

const mobile = { viewport: { width: 390, height: 844 }, locale: "ko-KR" };
const PASS = "다온모임2026";

test("암호로 잠근 단체 공간: 링크만으로는 참여하지 못하고, 암호가 맞아야 기록을 받는다", async ({ page, browser }) => {
  test.setTimeout(180_000);

  // 1. 총무가 암호를 정해 만든다
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.locator("#ws-pass").fill("1234");
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.getByTestId("workspace")).toContainText("암호는 6자 이상으로 정해 주세요.");
  await expect(page.locator("#invite-link")).toHaveCount(0);
  await page.locator("#ws-pass").fill(PASS);
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ws-locked")).toContainText("암호로 잠긴 공간입니다");
  const invite = await page.locator("#invite-link").inputValue();
  expect(invite).toContain("#join=p.");
  // 암호는 기기에 저장하지 않는다
  expect(await page.evaluate((p) => JSON.stringify({ ...localStorage }).includes(p), PASS)).toBe(false);
  await expect(page.getByTestId("workspace")).toContainText("동기화했습니다.", { timeout: 60_000 });

  // 2. 링크를 손에 넣은 사람: 암호 없이는, 그리고 틀린 암호로는 참여하지 못한다
  const other = await (await browser.newContext(mobile)).newPage();
  await other.goto(invite);
  await expect(other.locator("main")).toContainText("암호로 잠긴 공간이라");
  await other.locator("#j-name").fill("모르는사람");
  await other.getByRole("button", { name: "참여하기" }).click();
  await expect(other.locator("main")).toContainText("단체 공간 암호를 입력해 주세요.");
  await other.locator("#j-pass").fill("틀린암호123");
  await other.getByRole("button", { name: "참여하기" }).click();
  await expect(other.locator("main")).toContainText("암호가 맞지 않습니다.", { timeout: 60_000 });
  await expect(other.getByText("교통비")).toHaveCount(0);
  expect(await other.evaluate(() => localStorage.getItem("open-receipt:sync:v1"))).toBeNull(); // 참여한 것으로 남지 않는다

  // 3. 맞는 암호를 넣으면 기록을 받는다
  await other.locator("#j-pass").fill(PASS);
  await other.getByRole("button", { name: "참여하기" }).click();
  await expect(other.getByText("교통비").first()).toBeVisible({ timeout: 60_000 });
  await other.getByRole("button", { name: "설정" }).click();
  await expect(other.getByTestId("ws-locked")).toBeVisible();
  await expect(other.locator("#invite-link")).toHaveValue(invite); // 참여한 사람도 같은 초대 링크를 보낼 수 있다
});
