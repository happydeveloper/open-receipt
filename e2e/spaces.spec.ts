// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 한 기기에서 공간을 여러 개 쓰고, 사업별·거래처별 공유 링크를 보낸다.
 *
 *  1. 총무가 첫 공간에서 단체 공간을 만든다 (초대 링크 ㄱ).
 *  2. 설정에서 새 공간을 만들어 다른 단체로 시작한다. "여러 사람과 함께"가 기본이라 그 공간의 초대 링크(ㄴ)가 바로 만들어진다. 두 링크는 다르다.
 *     두 사람이 ㄴ으로 참여해 각자 올리면 총무의 새 공간에 모이고, 첫 공간의 기록과 섞이지 않는다.
 *     "이 기기에서만"으로 시작한 공간은 링크가 없다고 알려 주고, 공간 목록에서 바로 초대 링크를 만들 수 있다.
 *  3. 첫 공간을 다시 열면 첫 공간의 기록과 초대 링크 ㄱ이 그대로다. 두 공간의 기록은 섞이지 않는다.
 *  4. 사업 하나의 공유 링크를 열면 그 사업의 결산 내역이, 거래처 한 곳의 공유 링크를 열면 그 거래처와의 거래만 보인다.
 *  5. 다른 기기가 ㄱ에 참여한 뒤 ㄴ의 초대 링크를 열면, 공간이 따로 생겨 두 단체의 기록이 섞이지 않는다.
 *  6. 쓰지 않는 공간은 두 번 눌러 이 기기에서 지운다.
 */
import { expect, test, type Page } from "@playwright/test";

const mobile = { viewport: { width: 390, height: 844 }, locale: "ko-KR" };
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 90_000 }).toBeGreaterThan(before);
}
/** 영수증 없이 직접 적어 확정한다. */
async function writeDown(p: Page, item: string, amount: string, project: string) {
  await p.getByRole("button", { name: "+ 지출 추가" }).click();
  await p.getByRole("button", { name: "영수증이 없어요" }).click();
  await p.locator("#alt-reason").fill("현장 현금 결제로 영수증 미발급");
  await p.getByRole("button", { name: "직접 입력", exact: true }).click();
  await p.locator("#f-date").fill("2026-11-20");
  await p.locator("#f-amount").fill(amount);
  await p.locator("#f-item").fill(item);
  await p.locator("#f-pay").click();
  await p.getByRole("option", { name: "현금" }).click();
  await p.locator("#f-project").fill(project);
  await p.getByRole("button", { name: "내용 확정" }).click();
  await p.getByRole("button", { name: "검토 목록 보기" }).click();
  await p.getByRole("button", { name: "지출 목록으로" }).click();
}

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
  await expect(page.getByRole("radio", { name: "여러 사람과 함께" })).toBeChecked(); // 기본은 함께 쓰기
  await page.getByRole("button", { name: "시작하기" }).click();
  // 시작하자마자 이 공간의 초대 링크가 만들어져 설정 화면에 보인다
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("workspace")).toContainText("동기화했습니다.", { timeout: 60_000 });
  await expect(page.locator("#s-org")).toHaveValue("새벽 공부방");
  await expect(page.getByTestId("space-row")).toHaveCount(2);
  const inviteB = await page.locator("#invite-link").inputValue();
  expect(inviteB).not.toBe(inviteA);

  // 두 사람이 새 공간에 참여해 각자 올리면 총무의 새 공간에 모인다
  const joinB = async (name: string) => {
    const p = await (await browser.newContext(mobile)).newPage();
    await p.goto(inviteB);
    await p.locator("#j-name").fill(name);
    await p.getByRole("button", { name: "참여하기" }).click();
    await expect(p.getByRole("button", { name: "+ 지출 추가" })).toBeVisible({ timeout: 60_000 });
    return p;
  };
  const one = await joinB("이회원");
  await writeDown(one, "캠프 간식", "15000", "겨울 캠프");
  await syncDevice(one);
  const two = await joinB("최회원");
  await expect(two.getByText("캠프 간식").first()).toBeVisible({ timeout: 60_000 });
  await writeDown(two, "버스 대절", "200000", "겨울 캠프");
  await syncDevice(two);
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  await expect(page.getByText("캠프 간식").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("버스 대절").first()).toBeVisible();
  await expect(page.getByText("교통비")).toHaveCount(0); // 첫 공간의 기록은 보이지 않는다
  await syncDevice(one);
  await expect(one.getByText("버스 대절").first()).toBeVisible({ timeout: 60_000 });

  // "이 기기에서만"으로 시작한 공간: 링크가 없다고 알리고, 공간 목록에서 바로 만들 수 있다
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "새 공간 만들기" }).click();
  await expect(page.getByRole("heading", { name: "우리 단체로 시작하기" })).toBeVisible({ timeout: 60_000 });
  await page.locator("#s-org").fill("혼자 쓰는 모임");
  await page.locator("#s-submitter").fill("정총무");
  await page.locator("#s-project").fill("봄 소풍");
  await page.getByRole("radio", { name: "이 기기에서만" }).click();
  await page.getByRole("button", { name: "시작하기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await expect(page.getByTestId("ws-none")).toContainText("이 공간은 아직 초대 링크가 없습니다");
  await expect(page.locator("#invite-link")).toHaveCount(0);
  await page.getByTestId("spaces").getByRole("button", { name: "초대 링크 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  const inviteC = await page.locator("#invite-link").inputValue();
  expect([inviteA, inviteB]).not.toContain(inviteC);
  await expect(page.getByTestId("space-row")).toHaveCount(3);

  // 3. 첫 공간을 다시 연다
  const firstRow = page.getByTestId("space-row").filter({ hasText: "다온 나눔모임" });
  await expect(firstRow).toContainText("기록 2건 · 함께 쓰는 공간");
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
  await expect(member.getByText("버스 대절").first()).toBeVisible({ timeout: 60_000 }); // 새 공간에 모인 기록을 받는다
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
  await expect(page.getByTestId("space-row")).toHaveCount(2);
  const solo = page.getByTestId("space-row").filter({ hasText: "혼자 쓰는 모임" });
  await solo.getByRole("button", { name: "지우기" }).click();
  await solo.getByRole("button", { name: "지우기 확인" }).click();
  await expect(page.getByTestId("space-row")).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("@")))).toEqual([]);
  await expect(page.locator("#invite-link")).toHaveValue(inviteA); // 첫 공간은 그대로다
});

test("느린 연결: 동기화가 끝나기 전에 적은 기록이 사라지지 않고 다른 기기에 전해진다", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("workspace")).toContainText("동기화했습니다.", { timeout: 60_000 });
  const invite = await page.locator("#invite-link").inputValue();

  // 회원의 기기는 연결이 느리다: 서버와 주고받을 때마다 2초씩 걸린다
  const ctx = await browser.newContext(mobile);
  await ctx.route("**/api/sync/**", async (route) => { await new Promise((r) => setTimeout(r, 2000)); await route.continue(); });
  const member = await ctx.newPage();
  await member.goto(invite);
  await member.locator("#j-name").fill("이회원");
  await member.getByRole("button", { name: "참여하기" }).click();
  // 참여하자마자(첫 동기화가 끝나기 전에) 지출을 적는다
  await writeDown(member, "동기화 중에 적은 지출", "7000", "자원봉사자 워크숍");
  await expect(member.getByText("교통비").first()).toBeVisible({ timeout: 60_000 }); // 단체의 기록을 받았다
  await expect(member.getByText("동기화 중에 적은 지출").first()).toBeVisible(); // 방금 적은 기록이 그대로 있다
  await syncDevice(member);
  await expect(member.getByText("동기화 중에 적은 지출").first()).toBeVisible();

  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await expect(async () => {
    await syncDevice(page);
    await expect(page.getByText("동기화 중에 적은 지출").first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 60_000 });
});
