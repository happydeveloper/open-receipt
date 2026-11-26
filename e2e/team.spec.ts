// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 여러 사람이 각자 영수증을 올리고, 총무가 모아 보고, 승인을 받는다.
 *
 *  등장인물: 총무(김○○, 등록자), 회원 이회원·최회원(등록자), 대표 박대표(승인자). 기기 네 대.
 *
 *  1. 총무가 단체 공간을 만들고 초대 링크를 보낸다.
 *  2. 이회원이 참여해 영수증을 올리고(에이전트), 최회원이 참여해 영수증 없이 직접 적는다.
 *  3. 총무가 동기화하면 "누가 올린 지출 몇 건이 들어왔다"는 안내가 뜨고, 목록에 올린 사람이 보인다. 사람 이름으로 찾을 수 있다.
 *  4. 총무(등록자)에게는 승인 버튼이 없다. 대표가 참여해 이회원의 지출을 승인하고, 최회원의 지출은 사유를 적어 되돌린다.
 *     최회원에게 사유가 전해지고, 고쳐서 다시 확정한다. 총무는 검토 목록에 들어가기만 해도 이 소식을 받는다.
 *  5. 단체가 "등록자도 승인"으로 바꾸면 총무가 최회원의 지출과 자기가 올린 지출을 승인할 수 있다.
 *     직접 올린 지출을 승인한 것은 이력과 서명에 그대로 남는다.
 *  6. 모든 기기가 같은 결과를 보고, 결산보고서의 합계와 승인 완료 금액이 맞는다.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { askTurn, doneTurn, ndjson } from "./mocks";

const mobile = { viewport: { width: 390, height: 844 }, locale: "ko-KR" };
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 90_000 }).toBeGreaterThan(before);
}
async function join(browser: Browser, invite: string, name: string, approver = false): Promise<Page> {
  const p = await (await browser.newContext(mobile)).newPage();
  await p.goto(invite);
  await p.locator("#j-name").fill(name);
  if (approver) await p.getByRole("radio", { name: "승인하는 사람" }).click();
  await p.getByRole("button", { name: "참여하기" }).click();
  await expect(p.getByText("교통비").first()).toBeVisible({ timeout: 60_000 });
  return p;
}
/** 영수증 없이 직접 적어 확정한다. */
async function writeDown(p: Page, item: string, amount: string) {
  await p.getByRole("button", { name: "+ 지출 추가" }).click();
  await p.getByRole("button", { name: "영수증이 없어요" }).click();
  await p.locator("#alt-reason").fill("현장 현금 결제로 영수증 미발급");
  await p.getByRole("button", { name: "직접 입력", exact: true }).click();
  await p.locator("#f-date").fill("2026-11-20");
  await p.locator("#f-amount").fill(amount);
  await p.locator("#f-item").fill(item);
  await p.locator("#f-pay").click();
  await p.getByRole("option", { name: "현금" }).click();
  await p.locator("#f-project").fill("자원봉사자 워크숍");
  await p.getByRole("button", { name: "내용 확정" }).click();
  await p.getByRole("button", { name: "검토 목록 보기" }).click();
  await p.getByRole("button", { name: "지출 목록으로" }).click();
}

test("함께 모으기: 여러 사람이 올린 영수증을 총무가 모아 보고, 승인자와 등록자가 승인한다", async ({ page, browser }) => {
  test.setTimeout(300_000);

  // 1. 총무가 단체 공간을 만든다
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  const invite = await page.locator("#invite-link").inputValue();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);

  // 2. 이회원: 영수증을 올린다 (에이전트가 묻고, 답하고, 확정)
  const lee = await join(browser, invite, "이회원");
  let n = 0;
  await lee.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: n++ === 0 ? askTurn : doneTurn }));
  await expect(lee.locator("main")).toContainText("지출 2건이 들어왔습니다."); // 참여하자마자 그동안의 기록을 받는다
  await lee.getByRole("button", { name: "+ 지출 추가" }).click();
  await lee.getByRole("button", { name: "가상 영수증 사용" }).click();
  await lee.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await lee.getByRole("button", { name: "가림 상자 추가" }).click();
  await lee.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await lee.locator("#q-purpose").fill("워크숍 다과 구매");
  await lee.locator("#q-payer").fill("이회원");
  await lee.getByRole("radio", { name: "환급 필요" }).click();
  await lee.getByRole("button", { name: "답하고 계속" }).click();
  await lee.getByRole("button", { name: "내용 확정" }).click();
  await lee.getByRole("button", { name: "검토 목록 보기" }).click();
  await lee.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(lee);

  //    최회원: 영수증 없이 직접 적는다
  const choi = await join(browser, invite, "최회원");
  await writeDown(choi, "현수막 끈", "9000");
  await syncDevice(choi);

  // 3. 총무가 동기화하면 누가 무엇을 올렸는지 안내가 뜬다
  await syncDevice(page);
  await expect(page.locator("main")).toContainText(/(이회원, 최회원|최회원, 이회원) 님이 올린 지출 2건이 들어왔습니다\./);
  await expect(page.locator("main")).toContainText("개인 선결제 · 이회원");
  await expect(page.locator("main")).toContainText("현금 · 최회원");
  await page.locator("#search").fill("최회원");
  await expect(page.getByTestId("filter-result")).toContainText("찾은 1건 · 9,000원");
  await page.getByRole("button", { name: "모두 보기" }).click();

  // 4. 총무(등록자)에게는 승인 버튼이 없다. 검토 목록에 올린 사람이 보인다
  await page.getByRole("button", { name: "검토 목록" }).click();
  await expect(page.getByTestId("no-approve").first()).toHaveText("승인자가 승인합니다");
  await expect(page.getByRole("button", { name: "승인", exact: true })).toHaveCount(0);
  await expect(page.locator("main")).toContainText("올린 사람 이회원");
  await expect(page.locator("main")).toContainText("올린 사람 최회원");
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  //    대표가 참여해 이회원의 지출을 승인한다
  const park = await join(browser, invite, "박대표", true);
  await syncDevice(park);
  await park.getByRole("button", { name: "검토 목록" }).click();
  await park.getByRole("listitem").filter({ hasText: "행사 다과 26,400원" }).getByRole("button", { name: "승인", exact: true }).click();
  await expect(park.locator("main")).toContainText("행사 다과 26,400원을 승인했습니다.");
  //    최회원의 지출은 사유를 적어 되돌린다 (사유 없이는 되돌리지 못한다)
  await park.getByRole("button", { name: "지출 목록으로" }).click();
  await park.getByText("현수막 끈").first().click();
  await park.getByTestId("decide").getByRole("button", { name: "되돌리기" }).click();
  await expect(park.getByTestId("decide")).toContainText("되돌리는 사유를 적어 주세요");
  await park.locator("#return-reason").fill("어디서 샀는지 가게 이름을 적어 주세요");
  await park.getByTestId("decide").getByRole("button", { name: "되돌리기" }).click();
  await expect(park.locator("main")).toContainText("현수막 끈 9,000원을 되돌렸습니다. 최회원 님에게 사유가 전해집니다.");
  await park.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(park);

  //    최회원에게 사유가 전해진다. 고쳐서 다시 확정하면 다시 승인 대기가 된다
  await syncDevice(choi);
  await expect(choi.locator("main")).toContainText("박대표 님이 1건을 되돌렸습니다. 사유를 확인해 주세요.");
  await choi.getByText("현수막 끈").first().click();
  await expect(choi.locator("main")).toContainText("확인할 항목: 박대표 님이 되돌렸습니다. 사유: 어디서 샀는지 가게 이름을 적어 주세요");
  await choi.getByRole("button", { name: "수정", exact: true }).click();
  await choi.locator("#f-merchant").fill("가상철물점");
  await choi.getByRole("button", { name: "내용 확정" }).click();
  await expect(choi.getByTestId("saved-line")).toContainText("승인 대기");
  await choi.getByRole("button", { name: "검토 목록 보기" }).click();
  await choi.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(choi);

  //    총무는 검토 목록에 들어가기만 해도 최신 상태를 받는다 (방금 맞춘 것이 아니면 들어갈 때 한 번 맞춘다)
  await page.waitForTimeout(16_000);
  await page.getByRole("button", { name: "검토 목록" }).click();
  await expect(page.locator("main")).toContainText("박대표 님이 1건을 승인했습니다.", { timeout: 30_000 });
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 5. 단체가 "등록자도 승인"으로 바꾼다 → 총무가 최회원의 지출을 승인한다
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("radio", { name: "등록자도 승인" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "검토 목록" }).click();
  await page.getByRole("listitem").filter({ hasText: "현수막 끈 9,000원" }).getByRole("button", { name: "승인", exact: true }).click();
  await expect(page.locator("main")).toContainText("현수막 끈 9,000원을 승인했습니다.");
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  //    총무가 직접 올린 지출도 승인한다. 그 사실이 이력에 남는다
  await writeDown(page, "생수", "3000");
  await page.getByRole("button", { name: "검토 목록" }).click();
  await page.getByRole("listitem").filter({ hasText: "생수 3,000원" }).getByRole("button", { name: "승인", exact: true }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  await page.getByText("생수").first().click();
  await expect(page.getByTestId("history")).toContainText("승인했습니다 (직접 올린 지출)");
  await expect(page.getByTestId("detail")).toContainText("승인 방식올린 기기가 직접 승인했습니다");
  await expect(page.getByTestId("approval-audit")).toHaveCount(0);
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 6. 다른 기기들도 같은 결과를 본다
  for (const p of [lee, choi, park]) {
    await syncDevice(p);
    await p.getByRole("button", { name: "결산보고서" }).click();
    await expect(p.locator("#report-total")).toHaveText("68,900원"); // 30,500 + 26,400 + 9,000 + 3,000
    await expect(p.getByRole("row").filter({ hasText: "56,400원" }).first()).toBeVisible(); // 승인 완료: 18,000 + 26,400 + 9,000 + 3,000
    await p.getByRole("button", { name: "지출 목록으로" }).click();
  }
  //    대표의 기기: 등록자가 승인한 지출은 그렇다고 적혀 있고, 서명 검증에 문제가 없다
  await park.getByText("현수막 끈").first().click();
  await expect(park.getByTestId("detail")).toContainText("승인 방식등록자 기기가 승인했습니다");
  await expect(park.getByTestId("approval-audit")).toHaveCount(0);
  await park.getByRole("button", { name: "지출 목록으로" }).click();
  //    단체가 정한 승인 방식이 회원 기기에도 전해져, 이회원도 남은 승인 대기 건이 있으면 승인할 수 있다
  await lee.getByRole("button", { name: "설정" }).click();
  await expect(lee.getByRole("radio", { name: "등록자도 승인" })).toBeChecked();
});
