// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 사업 마감.
 *
 *  1. 총무(등록자)가 단체 공간을 만들고, 대표(승인자)가 참여한다.
 *  2. 총무에게는 마감 단추가 없다 (마감은 승인자가 한다).
 *  3. 대표가 결산보고서에서 사업을 마감한다. 끝나지 않은 기록이 있으면 먼저 알려 준다.
 *  4. 마감된 사업은 두 기기 모두에서 잠긴다: 수정, 삭제, 승인, 새 지출 올리기가 막힌다.
 *  5. 대표가 마감을 풀면 다시 고칠 수 있다.
 */
import { expect, test, type Page } from "@playwright/test";

const mobile = { viewport: { width: 390, height: 844 }, locale: "ko-KR" };
const P = "자원봉사자 워크숍";
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 90_000 }).toBeGreaterThan(before);
}

test("사업 마감: 승인자가 마감하면 모든 기기에서 기록이 잠기고, 풀면 다시 고칠 수 있다", async ({ page, browser }) => {
  test.setTimeout(240_000);

  // 1. 총무가 단체 공간을 만들고 대표가 참여한다
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  const invite = await page.locator("#invite-link").inputValue();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);

  const park = await (await browser.newContext(mobile)).newPage();
  await park.goto(invite);
  await park.locator("#j-name").fill("박대표");
  await park.getByRole("radio", { name: "승인하는 사람" }).click();
  await park.getByRole("button", { name: "참여하기" }).click();
  await expect(park.getByText("교통비").first()).toBeVisible({ timeout: 60_000 });

  // 2. 총무(등록자)에게는 마감 단추가 없다
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.getByTestId("closing")).toContainText("마감은 승인자가 합니다.");
  await expect(page.getByRole("button", { name: "이 사업 마감하기" })).toHaveCount(0);
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 3. 대표가 마감한다. 끝나지 않은 기록이 있다고 알려 준 뒤 확인을 받는다
  await park.getByRole("button", { name: "결산보고서" }).click();
  await park.getByRole("button", { name: "이 사업 마감하기" }).click();
  await expect(park.getByTestId("unfinished")).toContainText("아직 끝나지 않은 기록이 1건 있습니다");
  await park.getByRole("button", { name: "마감 확인" }).click();
  await expect(park.locator("main")).toContainText(`${P} 사업을 마감했습니다.`);
  await expect(park.getByTestId("closing")).toContainText("다온 나눔모임 (가상)에서");
  await expect(park.getByTestId("closing")).toContainText("마감 처리: 박대표"); // 처리한 사람은 구성원에게만 보인다
  await expect(park.getByRole("heading", { level: 1 })).toContainText("결산보고서 (마감)");
  await expect(park.getByTestId("report-closed")).toContainText("(다온 나눔모임 (가상))");
  await expect(park.getByTestId("report-closed")).not.toContainText("박대표"); // 보고서 본문에도 마감 표시가 붙는다 (인쇄와 공유에 함께 나간다)
  await park.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(park);

  // 4. 대표 기기: 수정과 삭제가 막힌다
  await expect(park.getByTestId("closed-note")).toContainText("마감된 사업입니다");
  await park.getByText("교통비").first().click();
  await expect(park.getByTestId("closed-note")).toBeVisible();
  await park.getByRole("button", { name: "수정", exact: true }).click();
  await expect(park.locator("main")).toContainText("사업은 마감되어 기록을 올리거나 고칠 수 없습니다.");
  await expect(park.locator("#f-amount")).toHaveCount(0); // 수정 화면으로 넘어가지 않는다
  await park.getByRole("button", { name: "지출 목록으로" }).click();

  //    총무 기기: 동기화하면 마감이 전해지고, 새 지출을 이 사업으로 올리지 못한다
  await syncDevice(page);
  await expect(page.getByTestId("closed-note")).toContainText("다온 나눔모임 (가상)에서");
  await expect(page.locator("#project")).toContainText("(마감)");
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "영수증이 없어요" }).click();
  await page.locator("#alt-reason").fill("현장 현금 결제로 영수증 미발급");
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.locator("#f-date").fill("2026-11-21");
  await page.locator("#f-amount").fill("5000");
  await page.locator("#f-item").fill("뒤늦은 지출");
  await page.locator("#f-pay").click();
  await page.getByRole("option", { name: "현금" }).click();
  await page.locator("#f-project").fill(P);
  await page.getByRole("button", { name: "내용 확정" }).click();
  await expect(page.locator("main")).toContainText("사업은 마감되어 기록을 올리거나 고칠 수 없습니다.");
  await expect(page.getByRole("button", { name: "검토 목록 보기" })).toHaveCount(0); // 저장되지 않았다
  //    다른 사업으로는 올릴 수 있다
  await page.locator("#f-project").fill("봄 캠프");
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.locator("#project").click();
  await page.getByRole("option", { name: `${P} (마감)` }).click();
  await expect(page.locator("main")).toContainText("지출2건"); // 마감된 사업의 건수는 그대로다

  // 5. 대표가 마감을 풀면 다시 고칠 수 있다
  await park.getByRole("button", { name: "결산보고서" }).click();
  await park.getByRole("button", { name: "마감 풀기" }).click();
  await park.getByRole("button", { name: "마감 풀기 확인" }).click();
  await expect(park.locator("main")).toContainText("마감을 풀었습니다.");
  await expect(park.getByRole("button", { name: "이 사업 마감하기" })).toBeVisible();
  await park.getByRole("button", { name: "지출 목록으로" }).click();
  await expect(park.getByTestId("closed-note")).toHaveCount(0);
  await park.getByText("교통비").first().click();
  await park.getByRole("button", { name: "수정", exact: true }).click();
  await expect(park.locator("#f-amount")).toBeVisible();
});
