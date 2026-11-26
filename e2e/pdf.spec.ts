// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: PDF로 받은 거래명세서를 그대로 올린다.
 *
 *  1. 영수증으로 지출 한 건을 만든다.
 *  2. 그 지출에 두 쪽짜리 거래명세서 PDF를 붙인다. 쪽마다 가릴 곳을 확인하고 붙인다.
 *  3. 한 지출에 사진 세 장(영수증, 거래명세서 1쪽, 2쪽)이 묶이고, 건수와 합계는 그대로다.
 *  4. PDF를 영수증 자리에 올려도 된다. 첫 쪽으로 지출을 기록하고 나머지 쪽은 저장한 뒤 이어서 붙인다.
 *  5. 여러 장 올리기에 PDF를 넣으면 쪽마다 한 장으로 센다.
 *  6. PDF가 아닌 파일은 이유를 알려 준다.
 *
 * PDF는 가상 서류를 화면에 그려 만든다.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { act, askTurn, doneTurn, finished, groupTurn, ndjson, sseBody, started } from "./mocks";

/** 두 쪽짜리 가상 거래명세서 PDF. */
async function statementPdf(browser: Browser): Promise<Buffer> {
  const p = await (await browser.newContext()).newPage();
  await p.setContent(`<body style="font-family:sans-serif;font-size:20px">
    <section style="page-break-after:always;padding:40px"><h1>거래명세서 (1/2)</h1><p>가상몰 · 시연용 가상 자료</p><p>받는 분 김가상 · 서울시 가상구 예시로 1</p><p>과자 모둠 세트 2 · 12,000원</p><p>음료 1.5L 4 · 8,400원</p></section>
    <section style="padding:40px"><h1>거래명세서 (2/2)</h1><p>종이컵·접시 1 · 6,000원</p><h2>합계 26,400원</h2><p>실제 거래가 아닙니다.</p></section></body>`);
  const pdf = await p.pdf({ format: "A4" });
  await p.context().close();
  return pdf;
}
const pdfFile = (buffer: Buffer, name = "거래명세서.pdf") => ({ name, mimeType: "application/pdf", buffer });

async function addReceipt(page: Page) {
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "가상 영수증 사용" }).click();
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.locator("#q-purpose").fill("워크숍 다과 구매");
  await page.locator("#q-payer").fill("김○○");
  await page.getByRole("radio", { name: "환급 필요" }).click();
  await page.getByRole("button", { name: "답하고 계속" }).click();
  await page.getByRole("button", { name: "내용 확정" }).click();
}

test("PDF 서류: 거래명세서 PDF를 쪽마다 그림으로 바꿔 붙이고, 영수증 자리와 여러 장 올리기에서도 받는다", async ({ page, browser }) => {
  test.setTimeout(180_000);
  let n = 0;
  await page.route("**/api/agent/expense", async (route) => {
    const body = route.request().postDataJSON();
    // 처음 두 번은 영수증 한 장(질문 → 답), 그 뒤로는 묻지 않고 끝나는 응답
    if (n++ < 2) return route.fulfill({ ...ndjson, body: n === 1 ? askTurn : doneTurn });
    const record = { ...body.state.record, date: "2026-11-19", amount: 33000, item: `현수막 ${n}`, paymentMethod: "org_card", project: "자원봉사자 워크숍" };
    await route.fulfill({ ...ndjson, body: sseBody(started, act("update_record", "기록을 채웠습니다"), act("finish", "정리를 마쳤습니다"), { type: "STATE_SNAPSHOT", snapshot: { ...body.state, record, docType: "거래명세서", aiFields: Object.keys(record), summary: "현수막 제작.", checklist: [], sources: [] } }, finished()) });
  });
  await page.route("**/api/agent/group", (route) => route.fulfill({ ...ndjson, body: groupTurn(route.request().postDataJSON().state.documents) }));
  const pdf = await statementPdf(browser);

  // 1. 영수증으로 지출 한 건
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await addReceipt(page);

  // 2. 두 쪽짜리 PDF를 붙인다: 1쪽 → 2쪽
  await page.getByRole("button", { name: "거래명세서 등 자료 붙이기" }).click();
  await page.locator("#att-file").setInputFiles(pdfFile(pdf));
  await expect(page.getByText("PDF 2쪽 가운데 1쪽입니다.")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".maskwrap img")).toBeVisible();
  const first = await page.locator(".maskwrap img").getAttribute("src");
  expect(first).toMatch(/^data:image\/jpeg;base64,/);
  await page.getByRole("button", { name: "가림 상자 추가" }).click();
  await page.getByRole("button", { name: "이 지출에 붙이기" }).click();
  await expect(page.locator("main")).toContainText("거래명세서 1쪽을 붙였습니다. 다음 쪽을 확인해 주세요 (남은 1쪽).");
  await expect(page.getByText("PDF 2쪽 가운데 2쪽입니다.")).toBeVisible();
  expect(await page.locator(".maskwrap img").getAttribute("src")).not.toBe(first); // 다음 쪽 그림으로 바뀌었다
  await expect(page.getByText("가린 상자 0개")).toBeVisible(); // 가림은 쪽마다 새로 한다
  await page.getByRole("button", { name: "이 지출에 붙이기" }).click();

  // 3. 한 지출에 세 장
  await expect(page.getByRole("heading", { name: "지출 상세" })).toBeVisible();
  await expect(page.getByTestId("detail")).toContainText("영수증 첨부 + 거래명세서 1쪽, 거래명세서 2쪽");
  await expect(page.getByTestId("receipt")).toHaveCount(3);
  await expect(page.getByTestId("receipt").nth(2)).toContainText("거래명세서 2쪽");
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.locator("#report-total")).toHaveText("56,900원");
  await expect(page.getByTestId("receipt")).toHaveCount(3);
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 4. 영수증 자리에 PDF를 올린다: 첫 쪽으로 기록하고, 나머지 쪽은 저장한 뒤 이어서 붙인다
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.locator("#file").setInputFiles(pdfFile(pdf, "현수막_거래명세서.pdf"));
  await expect(page.getByText("PDF 2쪽 가운데 1쪽입니다. 이 쪽으로 지출을 기록하고")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "PDF의 나머지 1쪽 붙이기" }).click();
  await expect(page.getByText("PDF 2쪽 가운데 2쪽입니다.")).toBeVisible();
  await page.getByRole("button", { name: "이 지출에 붙이기" }).click();
  await expect(page.getByTestId("receipt")).toHaveCount(2);
  await expect(page.getByTestId("attachments")).toContainText("거래명세서 2쪽");
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 5. 여러 장 올리기: PDF는 쪽마다 한 장
  await page.getByRole("button", { name: "영수증 여러 장 올리기" }).click();
  await page.locator("#bulk-files").setInputFiles([pdfFile(pdf, "묶음.pdf")]);
  await expect(page.getByTestId("bulk-list")).toContainText("묶음.pdf 1쪽", { timeout: 30_000 });
  await expect(page.getByTestId("bulk-list")).toContainText("묶음.pdf 2쪽");
  await expect(page.getByRole("button", { name: "2장 에이전트에게 맡기기" })).toBeVisible();

  // 6. PDF가 아닌 파일은 이유를 알려 준다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.locator("#file").setInputFiles({ name: "깨진파일.pdf", mimeType: "application/pdf", buffer: Buffer.from("이건 PDF가 아닙니다") });
  await expect(page.locator('.astryx-banner[data-status="error"]')).toContainText("PDF를 열지 못했습니다");
});
