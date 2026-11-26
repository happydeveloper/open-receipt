// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 백업 파일로 새 기기에 옮겨도 원본 사진이 따라온다.
 *
 *  1. 영수증으로 지출을 만든다 (가린 사진과 원본이 따로 보관된다).
 *  2. 설정에서 백업을 내려받는다. 파일에 원본이 들어 있다.
 *  3. 다른 기기에서 그 파일을 가져오면 가린 사진과 원본을 모두 볼 수 있다. 예전에는 원본이 사라졌다.
 *  4. 기록이 열 건 쌓였는데 백업한 적이 없으면 목록에서 백업을 권하고, 백업하면 사라진다.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { doneTurn, ndjson } from "./mocks";

test("백업: 원본 사진까지 담아 새 기기로 옮기고, 백업할 때가 되면 알려 준다", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: doneTurn }));
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "가상 영수증 사용" }).click();
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "가림 상자 추가" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await expect(page.getByTestId("backup-advice")).toHaveCount(0); // 세 건뿐이라 아직 권하지 않는다

  // 원본이 가린 사진과 다른지 먼저 본다
  await page.getByText("행사 다과").first().click();
  const here = page.getByTestId("receipt").first();
  const masked = await here.locator("img").getAttribute("src");
  await here.getByRole("radio", { name: "원본" }).click();
  await expect(here.getByAltText(/원본 영수증/)).toBeVisible();
  const original = await here.locator("img").getAttribute("src");
  expect(original).not.toBe(masked);
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 2. 백업을 내려받는다
  await page.getByRole("button", { name: "설정" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "백업 내보내기" }).click()]);
  await expect(page.locator("main")).toContainText("기록 3건, 원본 사진 1장이 들어 있습니다.");
  const path = (await dl.path())!;
  const file = JSON.parse(await readFile(path, "utf8"));
  expect(file.version).toBe(2);
  expect(Object.values(file.originals)).toEqual([original]);

  // 3. 다른 기기에서 가져온다
  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR" })).newPage();
  await other.goto("/app");
  await other.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await other.getByRole("button", { name: "설정" }).click();
  await other.locator("#import").setInputFiles(path);
  await expect(other.locator("main")).toContainText("기록 3건과 원본 사진 1장을 가져왔습니다.");
  await other.getByText("행사 다과").first().click();
  const there = other.getByTestId("receipt").first();
  expect(await there.locator("img").getAttribute("src")).toBe(masked);
  await there.getByRole("radio", { name: "원본" }).click();
  await expect(there.getByAltText(/원본 영수증/)).toBeVisible();
  expect(await there.locator("img").getAttribute("src")).toBe(original);

  // 4. 열 건이 쌓였는데 백업한 적 없는 기기에서는 백업을 권한다
  const fresh = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR" })).newPage();
  await fresh.goto("/app");
  await fresh.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await fresh.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("open-receipt:v1")!);
    for (let i = 0; i < 8; i++) list.push({ ...list[0], id: `more_${i}`, item: `지출 ${i}`, updatedAt: new Date().toISOString() });
    localStorage.setItem("open-receipt:v1", JSON.stringify(list));
  });
  await fresh.reload();
  await expect(fresh.getByTestId("backup-advice")).toContainText("10건 쌓였는데 아직 백업한 적이 없습니다");
  await Promise.all([fresh.waitForEvent("download"), fresh.getByRole("button", { name: "지금 백업 파일 내려받기" }).click()]);
  await expect(fresh.getByTestId("backup-advice")).toHaveCount(0);
});
