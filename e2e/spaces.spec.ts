// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 한 기기에서 공간을 여러 개 쓰고, 사업별·거래처별 공유 링크를 보낸다.
 *
 *  1. 총무가 첫 공간에서 단체 공간을 만든다 (초대 링크 ㄱ).
 *  2. 설정에서 새 공간을 만들어 다른 단체로 시작하고, 그 공간에서도 단체 공간을 만든다 (초대 링크 ㄴ). 두 링크는 다르다.
 *  3. 첫 공간을 다시 열면 첫 공간의 기록과 초대 링크 ㄱ이 그대로다. 두 공간의 기록은 섞이지 않는다.
 *  4. 사업 하나의 공유 링크를 열면 그 사업의 결산 내역이, 거래처 한 곳의 공유 링크를 열면 그 거래처와의 거래만 보인다.
 *  5. 다른 기기가 ㄱ에 참여한 뒤 ㄴ의 초대 링크를 열면, 공간이 따로 생겨 두 단체의 기록이 섞이지 않는다.
 *  6. 쓰지 않는 공간은 두 번 눌러 이 기기에서 지운다.
 */
import { expect, test } from "@playwright/test";

const mobile = { viewport: { width: 390, height: 844 }, locale: "ko-KR" };

test("공간 여러 개와 사업별·거래처별 공유 링크", async ({ page, browser }) => {
  test.setTimeout(300_000);

  // 1. 첫 공간: 데모 단체, 단체 공간 만들기
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await expect(page.getByTestId("space-row")).toHaveCount(1);
  await expect(page.getByTestId("space-row")).toContainText("지금 열려 있음");
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("workspace")).toContainText("동기화했습니다.", { timeout: 60_000 });
  const inviteA = await page.locator("#invite-link").inputValue();

  // 2. 새 공간: 다른 단체로 시작한다
  await page.getByRole("button", { name: "새 공간 만들기" }).click();
  await expect(page.getByRole("heading", { name: "우리 단체로 시작하기" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "만들지 않고 돌아가기" })).toBeVisible();
  await page.locator("#s-org").fill("새벽 공부방");
  await page.locator("#s-submitter").fill("정총무");
  await page.locator("#s-project").fill("겨울 캠프");
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(page.getByText("교통비")).toHaveCount(0); // 첫 공간의 기록은 보이지 않는다
  await page.getByRole("button", { name: "설정" }).click();
  await expect(page.locator("#s-org")).toHaveValue("새벽 공부방");
  await expect(page.getByTestId("space-row")).toHaveCount(2);
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("workspace")).toContainText("동기화했습니다.", { timeout: 60_000 });
  const inviteB = await page.locator("#invite-link").inputValue();
  expect(inviteB).not.toBe(inviteA);

  // 3. 첫 공간을 다시 연다
  const firstRow = page.getByTestId("space-row").filter({ hasText: "다온 나눔모임" });
  await expect(firstRow).toContainText("기록 2건 · 단체 공간");
  await firstRow.getByRole("button", { name: "열기" }).click();
  await expect(page.getByText("교통비").first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "설정" }).click();
  await expect(page.locator("#s-org")).toHaveValue("다온 나눔모임 (가상)");
  await expect(page.locator("#invite-link")).toHaveValue(inviteA);

  // 4. 사업별·거래처별 공유 링크
  await page.getByTestId("project-links").getByRole("button", { name: "공유 링크 복사" }).first().click();
  await expect(page.locator("#scope-link")).toBeVisible();
  const projectLink = await page.locator("#scope-link").inputValue();
  const reader = await (await browser.newContext(mobile)).newPage();
  await reader.goto(projectLink);
  await expect(reader.getByRole("heading", { name: "자원봉사자 워크숍 결산보고서" })).toBeVisible({ timeout: 60_000 });
  await expect(reader.locator("#report-total")).toHaveText("30,500원");

  await page.getByTestId("vendors").getByRole("button", { name: "공유 링크 복사" }).first().click();
  await expect(page.locator("#scope-link")).not.toHaveValue(projectLink);
  const vendorLink = await page.locator("#scope-link").inputValue();
  await reader.goto(vendorLink);
  await reader.reload(); // 같은 화면에서 # 뒤만 바뀌므로 새로 읽는다
  await expect(reader.getByRole("heading", { name: "○○인쇄 거래 내역" })).toBeVisible({ timeout: 60_000 });
  await expect(reader.locator("#report-total")).toHaveText("18,000원");
  await expect(reader.locator("main")).not.toContainText("교통비"); // 다른 지출은 보이지 않는다
  await expect(reader.locator("main")).not.toContainText("환급 대상");

  // 5. 다른 기기: ㄱ에 참여한 뒤 ㄴ의 링크를 열면 공간이 따로 생긴다
  const member = await (await browser.newContext(mobile)).newPage();
  await member.goto(inviteA);
  await member.locator("#j-name").fill("이회원");
  await member.getByRole("button", { name: "참여하기" }).click();
  await expect(member.getByText("교통비").first()).toBeVisible({ timeout: 60_000 });
  await member.goto(inviteB);
  await member.reload();
  await expect(member.getByRole("heading", { name: "초대받은 단체 공간에 참여합니다" })).toBeVisible({ timeout: 60_000 });
  await expect(member.locator("main")).not.toContainText("단체 공간에 합쳐집니다"); // 첫 단체의 기록을 올리지 않는다
  await member.locator("#j-name").fill("이회원");
  await member.getByRole("button", { name: "참여하기" }).click();
  await expect(member.getByRole("button", { name: "설정" })).toBeVisible({ timeout: 60_000 });
  await expect(member.getByText("교통비")).toHaveCount(0);
  await member.getByRole("button", { name: "설정" }).click();
  await expect(member.locator("#s-org")).toHaveValue("새벽 공부방", { timeout: 60_000 });
  await expect(member.getByTestId("space-row")).toHaveCount(2);
  // 이미 참여한 단체 공간의 링크를 다시 열면 그 공간이 열린다
  await member.goto(inviteA);
  await member.reload();
  await expect(member.getByText("교통비").first()).toBeVisible({ timeout: 60_000 });
  await member.getByRole("button", { name: "설정" }).click();
  await expect(member.getByTestId("space-row")).toHaveCount(2);

  // 6. 쓰지 않는 공간을 이 기기에서 지운다
  const other = page.getByTestId("space-row").filter({ hasText: "새벽 공부방" });
  await other.getByRole("button", { name: "지우기" }).click();
  await expect(page.getByTestId("spaces")).toContainText("이 기기에서만 지워집니다");
  await other.getByRole("button", { name: "지우기 확인" }).click();
  await expect(page.getByTestId("space-row")).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("@")))).toEqual([]);
  await expect(page.locator("#invite-link")).toHaveValue(inviteA); // 첫 공간은 그대로다
});
