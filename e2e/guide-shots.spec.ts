// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 사용 안내 페이지(/guide)에 넣을 화면 사진을 실제 앱에서 캡처한다. SHOTS_GUIDE=1일 때만 실행.
 *   SHOTS_GUIDE=1 npx playwright test e2e/guide-shots.spec.ts
 * 등록자, 승인자, 후원자 세 사람이 각자 기기에서 하는 일을 순서대로 따라가며 찍는다.
 * 눌러야 할 곳에는 빨간 테두리를 그려 넣는다. 단체와 영수증은 모두 가상 자료다.
 */
import { test, type Browser, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { askTurn, closeTurn, doneTurn, ndjson } from "./mocks";

test.skip(!process.env.SHOTS_GUIDE, "SHOTS_GUIDE=1일 때만 실행");
const phone = { viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, locale: "ko-KR" };
test.use(phone);

const hideDevTools = (page: Page) => page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
/**
 * 화면을 찍는다. target을 주면 그곳을 화면 가운데로 옮기고 빨간 테두리를 그린 뒤 찍는다.
 * 테두리는 대상에 직접 그리지 않고 화면 맨 위에 따로 얹는다. 대상에 그리면 바깥 상자가
 * 넘치는 부분을 잘라 내서 테두리 한쪽이 잘려 보인다. row를 주면 대상이 든 목록 줄 전체를 두른다.
 */
async function shot(page: Page, name: string, target?: Locator, row = false) {
  await hideDevTools(page);
  if (target) {
    await target.evaluate((el: HTMLElement) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    await target.evaluate((el: HTMLElement, wholeRow: boolean) => {
      const box = ((wholeRow && el.closest("li, [role='listitem']")) || el).getBoundingClientRect();
      const pad = 5, edge = 3;
      const left = Math.max(edge, box.left - pad), top = Math.max(edge, box.top - pad);
      const right = Math.min(window.innerWidth - edge, box.right + pad), bottom = Math.min(window.innerHeight - edge, box.bottom + pad);
      const ring = document.createElement("div");
      ring.id = "guide-ring";
      ring.style.cssText = `position:fixed;z-index:99999;pointer-events:none;box-sizing:border-box;border:4px solid #e5484d;border-radius:12px;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px`;
      document.body.appendChild(ring);
    }, row);
  } else await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `public/guide/${name}.png` });
  await page.evaluate(() => document.getElementById("guide-ring")?.remove());
}
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await test.expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 60_000 }).toBeGreaterThan(before);
}
/** 끌어서 가림 상자를 그린다 (사진 높이의 from~to 구간). */
async function drawBox(page: Page, from: number, to: number) {
  const box = (await page.locator(".maskwrap").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * from);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * to, { steps: 4 });
  await page.mouse.up();
}
/** 가상 온라인몰 거래명세서 그림. */
async function statementPng(browser: Browser): Promise<Buffer> {
  const p = await (await browser.newContext({ viewport: { width: 420, height: 470 }, deviceScaleFactor: 2 })).newPage();
  await p.setContent(`<body style="font-family:'Apple SD Gothic Neo',sans-serif;padding:24px;margin:0"><h2 style="margin:0 0 8px">거래명세서</h2><p>가상몰 (시연용 가상 자료)</p>
    <p>주문일 2026-11-18 · 주문번호 V-0000-0001</p><p>받는 분 김가상 · 서울시 가상구 예시로 1</p>
    <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%"><tr><th>품목</th><th>수량</th><th>금액</th></tr>
    <tr><td>과자 모둠 세트</td><td>2</td><td>12,000</td></tr><tr><td>음료 1.5L</td><td>4</td><td>8,400</td></tr><tr><td>종이컵·접시</td><td>1</td><td>6,000</td></tr>
    <tr><td colspan="2"><b>합계</b></td><td><b>26,400원</b></td></tr></table><p style="color:#666;font-size:13px">실제 거래가 아닙니다.</p></body>`);
  const png = await p.screenshot();
  await p.context().close();
  return png;
}

test("사용 안내용 화면 캡처", async ({ page, browser }) => {
  test.setTimeout(300_000);
  let n = 0;
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: n++ === 0 ? askTurn : doneTurn }));
  await page.route("**/api/agent/close", (route) => route.fulfill({ ...ndjson, body: closeTurn }));
  const receipt = readFileSync("public/demo-receipt.png");

  /* ---------- 등록자 (총무) ---------- */
  await page.goto("/app");
  await page.locator("#s-org").fill("다온 나눔모임");
  await page.locator("#s-submitter").fill("김다온");
  await page.locator("#s-approver").fill("박대표");
  await page.locator("#s-project").fill("자원봉사자 워크숍");
  await shot(page, "r01-start", page.getByRole("button", { name: "시작하기" }));
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();

  await shot(page, "r02-add", page.getByRole("button", { name: "+ 지출 추가" }));
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.locator("#file").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: receipt });
  await page.getByAltText("올린 영수증 미리보기").waitFor();
  await shot(page, "r03-upload", page.getByRole("button", { name: "다음: 가릴 부분 확인" }));
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await drawBox(page, 0.8, 0.9);
  await shot(page, "r04-mask", page.getByRole("button", { name: "에이전트에게 맡기기" }));
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.locator("#q-purpose").fill("워크숍 다과 구매");
  await page.locator("#q-payer").fill("김○○");
  await page.getByRole("radio", { name: "환급 필요" }).click();
  await shot(page, "r05-ask", page.getByRole("button", { name: "답하고 계속" }));
  await page.getByRole("button", { name: "답하고 계속" }).click();
  await page.locator("#f-summary").waitFor();
  await shot(page, "r06-confirm", page.getByRole("button", { name: "내용 확정" }));
  await page.getByRole("button", { name: "내용 확정" }).click();
  await shot(page, "r07-saved", page.getByRole("button", { name: "거래명세서 등 자료 붙이기" }));

  // 거래명세서를 같은 지출에 붙인다
  await page.getByRole("button", { name: "거래명세서 등 자료 붙이기" }).click();
  await page.locator("#att-file").setInputFiles({ name: "statement.png", mimeType: "image/png", buffer: await statementPng(browser) });
  await page.locator(".maskwrap").waitFor();
  await page.locator(".maskwrap").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await drawBox(page, 0.285, 0.36);
  await shot(page, "r08-attach", page.getByRole("button", { name: "이 지출에 붙이기" }));
  await page.getByRole("button", { name: "이 지출에 붙이기" }).click();
  await page.getByTestId("attachments").waitFor();
  await shot(page, "r09-bundle", page.getByTestId("attachments"));

  // 단체 공간: 초대 링크와 후원자용 링크
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await shot(page, "r10-settings", page.getByRole("button", { name: "설정" }));
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await page.locator("#invite-link").waitFor({ timeout: 30_000 });
  const invite = await page.locator("#invite-link").inputValue();
  await shot(page, "r11-invite", page.locator("#invite-link"));
  await page.getByRole("radio", { name: "열림" }).click();
  await page.locator("#viewer-link").waitFor();
  const viewerLink = await page.locator("#viewer-link").inputValue();
  await shot(page, "r14-sponsor-link", page.locator("#viewer-link"));
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);

  /* ---------- 승인자 (대표) ---------- */
  const approver = await (await browser.newContext(phone)).newPage();
  await approver.goto(invite);
  await approver.locator("#j-name").fill("박대표");
  await approver.getByRole("radio", { name: "승인하는 사람" }).click();
  await shot(approver, "a01-join", approver.getByRole("button", { name: "참여하기" }));
  await approver.getByRole("button", { name: "참여하기" }).click();
  await approver.getByText("행사 다과").waitFor({ timeout: 30_000 });
  await syncDevice(approver);
  await shot(approver, "a02-list", approver.getByText("행사 다과").first(), true);
  await approver.getByText("행사 다과").first().click();
  await approver.getByTestId("receipt").first().locator("img").waitFor();
  await shot(approver, "a03-detail", approver.getByTestId("receipt").first().getByRole("radiogroup"));
  await approver.getByRole("button", { name: "지출 목록으로" }).click();
  await approver.getByRole("button", { name: "검토 목록" }).click();
  await shot(approver, "a04-approve", approver.getByRole("button", { name: "승인", exact: true }).first());
  await approver.getByRole("button", { name: "승인", exact: true }).first().click();
  await approver.getByText(/승인했습니다/).first().waitFor();
  await shot(approver, "a05-approved");
  await approver.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(approver);

  /* ---------- 등록자: 마감 점검과 결산보고서 ---------- */
  await syncDevice(page);
  await page.getByRole("button", { name: "검토 목록" }).click();
  await page.getByRole("button", { name: "마감 점검 맡기기" }).click();
  await page.getByTestId("briefing").waitFor();
  await shot(page, "r12-close", page.getByTestId("briefing"));
  await page.getByRole("button", { name: "결산보고서 보기" }).click();
  await shot(page, "r13-report");
  await shot(page, "r15-download", page.getByRole("button", { name: "보고서 내려받기" }));

  /* ---------- 후원자 ---------- */
  const sponsor = await (await browser.newContext(phone)).newPage();
  await sponsor.goto(viewerLink);
  await sponsor.locator("#report-total").waitFor({ timeout: 30_000 });
  await shot(sponsor, "s01-report");
  await sponsor.getByTestId("receipt").first().locator("img").waitFor({ timeout: 20_000 });
  await sponsor.getByRole("heading", { name: "8. 영수증" }).evaluate((el) => el.scrollIntoView({ block: "start" }));
  await sponsor.waitForTimeout(600);
  await hideDevTools(sponsor);
  await sponsor.screenshot({ path: "public/guide/s02-receipts.png" });
  await shot(sponsor, "s03-print", sponsor.getByRole("button", { name: "인쇄" }));
});
