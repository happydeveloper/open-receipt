// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, test } from "@playwright/test";

// 실제 Liner API를 거치는 흐름. LIVE=1일 때만 실행한다 (크레딧 사용).
//   LIVE=1 BASE_URL=https://open-receipt-six.vercel.app npx playwright test e2e/live.spec.ts
test.skip(!process.env.LIVE, "LIVE=1일 때만 실행");

test("실제 Liner 연동: 영수증 → 지출 에이전트 → 확정 → 마감 점검 에이전트 → 결산보고서", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "가상 영수증 사용" }).click();
  await expect(page.getByAltText("올린 영수증 미리보기")).toBeVisible();
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  // 카드번호·구매자 줄을 가린다 (영수증 아래쪽)
  const box = await page.locator(".maskwrap").boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.05, box!.y + box!.height * 0.80);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.95, box!.y + box!.height * 0.90, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText("가린 상자 1개")).toBeVisible();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();

  const confirm = page.getByRole("button", { name: "내용 확정" });
  const answer = page.getByRole("button", { name: "답하고 계속" });
  for (let round = 0; round < 3; round++) {
    await expect(confirm.or(answer).or(page.locator('.astryx-banner[data-status="error"]'))).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('.astryx-banner[data-status="error"]')).toHaveCount(0);
    if (await confirm.isVisible()) break;
    const asked = await page.locator('[data-testid="question"] h3').allInnerTexts();
    console.log(`질문 ${round + 1}:`, asked.join(" | "));
    const projectBtn = page.getByRole("button", { name: "자원봉사자 워크숍" });
    if (await projectBtn.count()) await projectBtn.click();
    if (await page.locator("#q-purpose").count()) await page.locator("#q-purpose").fill("워크숍 다과 구매");
    if (await page.locator("#q-budget").count()) await page.locator("#q-budget").fill("회의·행사비");
    if (await page.locator("#q-payer").count()) {
      await page.locator("#q-payer").fill("김○○");
      await page.getByRole("radio", { name: "환급 필요" }).click();
    }
    await answer.click();
  }
  await expect(confirm).toBeVisible();
  const log = await page.getByLabel("에이전트가 한 일").locator("li").allInnerTexts();
  console.log("에이전트가 한 일:\n  " + log.map((l) => l.replace(/\n/g, " — ")).join("\n  "));
  const bundle = await page.getByTestId("bundle").innerText();
  console.log("증빙 묶음:\n  " + bundle.replace(/\n/g, " ").replace(/\s{2,}/g, " "));
  const summary = await page.locator("#f-summary").inputValue();
  console.log("요약:", summary);
  const checks = await page.locator('[data-testid="check"]').allInnerTexts();
  console.log("확인할 자료:", checks.length ? "\n  " + checks.join("\n  ") : "(없음)");

  expect(bundle).toContain("26,400원");
  expect(bundle).toContain("11/18");
  expect(bundle).toContain("자원봉사자 워크숍");
  expect(summary).not.toBe("");
  expect(summary + checks.join()).not.toMatch(/부적법|위반|불법/);
  expect(log.length).toBeGreaterThanOrEqual(4);
  for (const href of await page.locator('[data-testid="check"] a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) expect(href).toMatch(/^https?:\/\//);

  await confirm.click();
  await expect(page.getByTestId("saved-line")).toContainText("26,400원");
  await expect(page.getByTestId("saved-line")).toContainText("승인 대기");
  await page.getByRole("button", { name: "검토 목록 보기" }).click();

  // 마감 점검 에이전트
  await page.getByRole("button", { name: "마감 점검 맡기기" }).click();
  await expect(page.getByTestId("briefing")).toBeVisible({ timeout: 120_000 });
  console.log("브리핑:", await page.getByTestId("briefing").innerText());
  const reqs = await page.locator('[data-testid="request"]').allInnerTexts();
  console.log("요청 초안:\n  " + reqs.join("\n  "));
  expect(reqs.length).toBeGreaterThanOrEqual(1);
  expect((await page.getByTestId("briefing").innerText()) + reqs.join()).not.toMatch(/부적법|위반|불법/);

  await page.getByRole("button", { name: "승인", exact: true }).click();
  await page.getByRole("button", { name: "결산보고서 보기" }).click();
  await expect(page.locator("#report-total")).toHaveText("56,900원");
});
