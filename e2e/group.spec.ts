// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 한 번 쓴 돈의 서류 세 장(카드영수증, 거래명세서, 주문 화면)과 다른 영수증 한 장을 한꺼번에 올린다.
 *
 *  1. 네 장이 네 건의 초안이 된다. 이대로면 같은 돈이 세 번 잡힌다.
 *  2. 묶음 에이전트가 세 장을 한 거래로 제안한다. 이유와 남길 기록을 보여 준다.
 *  3. "한 건으로 합치기"를 누르면 두 건으로 줄고, 합계가 바로잡힌다.
 *  4. 결산보고서에 사진 네 장이 그대로 있고, 세 장은 한 지출 아래에 묶여 있다.
 *  5. 검토 화면에서 다시 찾으면 더 묶을 것이 없다.
 *  6. 같은 거래의 서류를 한 장 더 올리면, 새 지출로 저장하지 않고 기존 기록에 붙일 수 있다.
 *
 * 에이전트 응답은 가짜다 (실제 Liner 호출은 e2e/group-live.spec.ts).
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { act, finished, groupTurn, ndjson, sseBody, started } from "./mocks";

const papers = [
  { name: "카드영수증.png", record: { date: "2026-11-18", amount: 26400, merchant: "가상페이", paymentMethod: "org_card" }, docType: "카드영수증" },
  { name: "거래명세서.png", record: { date: "2026-11-18", amount: 26400, merchant: "가상몰(주)", item: "행사 다과", paymentMethod: "org_card", budgetCategory: "회의·행사비" }, docType: "거래명세서" },
  { name: "주문화면.png", record: { date: "2026-11-17", amount: 26400, merchant: "가상몰", item: "과자 모둠 세트 외", paymentMethod: "org_card" }, docType: "주문내역" },
  { name: "현수막.png", record: { date: "2026-11-18", amount: 18000, merchant: "가상인쇄", item: "현수막", paymentMethod: "org_card" }, docType: "간이영수증" },
];

test("같은 거래 묶기: 따로 올린 카드영수증·거래명세서·주문 화면을 에이전트가 찾아 제안하고, 사람이 눌러 한 건으로 합친다", async ({ page }) => {
  test.setTimeout(120_000);
  const png = readFileSync("public/demo-receipt.png");
  let bulkDone = false;
  await page.route("**/api/agent/expense", async (route) => {
    const body = route.request().postDataJSON();
    // 여러 장 올리기가 끝난 뒤의 호출은 한 장 올리기다. 가맹점이 안 보이는 배송 상자 사진으로 읽힌 것으로 한다.
    if (bulkDone) {
      const record = { ...body.state.record, date: "2026-11-18", amount: 26400, item: "다과 배송 상자", paymentMethod: "org_card", project: "자원봉사자 워크숍" };
      return route.fulfill({ ...ndjson, body: sseBody(started, act("update_record", "기록을 채웠습니다"), act("finish", "정리를 마쳤습니다"), { type: "STATE_SNAPSHOT", snapshot: { ...body.state, record, docType: "기타", aiFields: Object.keys(record), summary: "다과 배송 상자 사진.", checklist: [], sources: [] } }, finished()) });
    }
    // 파일마다 다른 서류로 읽힌 것처럼 답한다 (어느 파일인지는 요청 순서로 정한다)
    const p = papers[seen++];
    await route.fulfill({ ...ndjson, body: sseBody(started, act("update_record", "기록을 채웠습니다"), { type: "STATE_SNAPSHOT", snapshot: { ...body.state, record: { ...body.state.record, ...p.record }, docType: p.docType, aiFields: Object.keys(p.record), summary: `${p.docType} 정리.`, checklist: [], sources: [] } }, finished()) });
  });
  let seen = 0;
  const groupBodies: any[] = [];
  await page.route("**/api/agent/group", async (route) => {
    const body = route.request().postDataJSON();
    groupBodies.push(body);
    const same = body.state.documents.filter((d: any) => d.amount === 26400);
    const main = same.find((d: any) => d.docType === "카드영수증");
    const groups = same.length >= 2 && main ? [{ ids: same.map((d: any) => d.id), mainId: main.id, reason: "세 서류의 금액이 26,400원으로 같고, 주문일과 결제일이 하루 차이입니다. 가맹점 표기는 다르지만 같은 온라인몰 결제로 보입니다.", mismatch: "" }] : [];
    await route.fulfill({ ...ndjson, body: groupTurn(body.state.documents, groups) });
  });

  // 1. 네 장을 한꺼번에 올린다
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "영수증 여러 장 올리기" }).click();
  // 한 장씩 차례로 처리되도록 한 장씩 올려 맡긴다 (가짜 응답이 요청 순서에 기대기 때문)
  for (const [i, p] of papers.entries()) {
    await page.locator("#bulk-files").setInputFiles({ name: p.name, mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "1장 에이전트에게 맡기기" }).click();
    await expect(page.getByText(`${i + 1}장을 초안으로 정리했습니다.`)).toBeVisible({ timeout: 30_000 });
  }
  bulkDone = true;

  // 2. 묶음 에이전트가 세 장을 한 거래로 제안한다
  const group = page.getByTestId("group");
  await expect(group).toHaveCount(1);
  await expect(group).toContainText("한 거래로 보이는 서류 3장");
  await expect(group).toContainText("카드영수증");
  await expect(group).toContainText("거래명세서 · 행사 다과 · 26,400원");
  await expect(group).toContainText("주문내역");
  await expect(group).toContainText("가맹점 표기는 다르지만");
  await expect(group.getByText("남길 기록", { exact: true })).toHaveCount(1);
  await expect(page.getByTestId("group-card")).not.toContainText("현수막");
  // 에이전트에는 글자 정보만 간다
  const sent = groupBodies.at(-1);
  expect(sent.state.documents).toHaveLength(4);
  expect(JSON.stringify(sent)).not.toContain("data:image");

  // 3. 사람이 눌러야 합쳐진다
  await group.getByRole("button", { name: "한 건으로 합치기" }).click();
  await expect(page.locator("main")).toContainText("서류 3장을 한 건으로 합쳤습니다.");
  await expect(page.getByTestId("group")).toHaveCount(0);
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await expect(page.getByText("초안", { exact: true })).toHaveCount(2);

  // 합친 기록: 카드영수증이 남고, 빈 항목은 거래명세서에서 읽은 값으로 채워졌다
  await page.getByText("행사 다과").first().click();
  await expect(page.getByTestId("detail")).toContainText("가상페이");
  await expect(page.getByTestId("detail")).toContainText("영수증 첨부 + 거래명세서, 주문내역");
  await expect(page.getByTestId("receipt")).toHaveCount(3);
  await expect(page.getByTestId("history")).toContainText("같은 거래의 서류 3건을 한 건으로 합쳤습니다");
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 4. 결산보고서: 데모 2건 + 합친 1건 + 현수막 1건, 금액은 한 번만 잡힌다
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.locator("#report-total")).toHaveText("74,900원"); // 30,500 + 26,400 + 18,000
  await expect(page.locator("main")).toContainText("4건");
  await expect(page.getByTestId("receipt")).toHaveCount(4);
  await expect(page.getByTestId("receipt").filter({ hasText: "행사 다과 · 26,400원" })).toHaveCount(3);

  // 5. 검토 화면에서 다시 찾으면 묶을 것이 없다
  await page.getByRole("button", { name: "검토 목록으로" }).click();
  await page.getByTestId("group-card").getByRole("button", { name: "다시 찾기" }).click();
  await expect(page.getByTestId("group-card")).toContainText("한 거래로 묶을 서류를 찾지 못했습니다.");
  await expect(page.getByTestId("group")).toHaveCount(0);

  // 6. 같은 거래의 서류를 한 장 더 올리면, 새 지출 대신 기존 기록에 붙일 수 있다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "가상 영수증 사용" }).click();
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await expect(page.getByTestId("dup-warning")).toBeVisible();
  await page.getByRole("button", { name: "기존 기록에 자료로 붙이기" }).click();
  await expect(page.locator("main")).toContainText("새 지출을 만들지 않고, 이 기록의 자료로 붙였습니다.");
  await expect(page.getByTestId("receipt")).toHaveCount(4);
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.locator("#report-total")).toHaveText("74,900원");
  await expect(page.getByTestId("receipt")).toHaveCount(5);
});
