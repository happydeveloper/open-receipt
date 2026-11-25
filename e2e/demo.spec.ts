// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 브라우저 흐름 테스트. 실제 화면을 조작해 처음부터 끝까지 확인한다.
 * 에이전트 응답은 e2e/mocks.ts의 가짜 이벤트 스트림으로 바꿔 끼우므로 Liner 크레딧을 쓰지 않는다.
 * 단체 공간 흐름은 브라우저 창 두 개를 서로 다른 기기로 쓴다.
 */
import { expect, test, type Page } from "@playwright/test";

import { sseBody, started, finished, act, base, agentState, askQuestions, askTurn, sources, summary, checklist, doneTurn, closeTurn, ndjson, groupTurn } from "./mocks";

async function toMask(page: Page) {
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "가상 영수증 사용" }).click();
  await expect(page.getByAltText("올린 영수증 미리보기")).toBeVisible();
}

test("시연 시나리오: 영수증 → 에이전트(기록·질문·검색) → 확정 → 승인 → 마감 점검 → 결산보고서", async ({ page }) => {
  const bodies: any[] = [];
  await page.route("**/api/agent/expense", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ ...ndjson, body: bodies.length === 1 ? askTurn : doneTurn });
  });
  await page.route("**/api/agent/close", (route) => route.fulfill({ ...ndjson, body: closeTurn }));

  await toMask(page);
  await page.locator("#memo").fill("간식 샀어요 1234-5678-9012-3456");
  if (process.env.SHOTS) await page.screenshot({ path: `test-results/shot-1-upload.png`, fullPage: true });
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "가림 상자 추가" }).click();
  await expect(page.getByText("가린 상자 1개")).toBeVisible();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();

  // 에이전트가 한 일이 순서대로 보이고, 모르는 것만 묻는다
  const log = page.getByLabel("에이전트가 한 일");
  await expect(log.getByText("지난 기록을 확인했습니다")).toBeVisible();
  await expect(log.getByText("알 수 없는 2가지를 여쭙니다")).toBeVisible();
  await expect(page.getByText("무엇을 위해 사셨나요?")).toBeVisible();
  await expect(page.getByText("어느 행사")).toHaveCount(0);
  // 요청은 AG-UI RunAgentInput: 이미지는 user 메시지의 image 파트, 기록은 state, 질문 도구는 tools
  const in0 = bodies[0];
  expect(typeof in0.threadId).toBe("string");
  expect(typeof in0.runId).toBe("string");
  const parts = in0.messages[0].content;
  expect(parts[0].text).toContain("[카드번호 가림]");
  expect(parts[0].text).not.toContain("1234-5678-9012-3456");
  expect(parts[1]).toMatchObject({ type: "image", source: { type: "data", mimeType: "image/jpeg" } });
  expect(in0.tools.map((t: any) => t.name)).toEqual(["ask_user"]);
  expect(in0.state.record.project).toBeUndefined();
  expect(in0.state.history).toHaveLength(2);

  if (process.env.SHOTS) await page.screenshot({ path: `test-results/shot-2-ask.png`, fullPage: true });
  await page.locator("#q-purpose").fill("워크숍 다과 구매");
  await page.locator("#q-payer").fill("김○○");
  await page.getByRole("radio", { name: "환급 필요" }).click();
  await page.getByRole("button", { name: "답하고 계속" }).click();

  // 답변과 상태를 들고 이어서 진행한다
  await expect(log.getByText("정리를 마쳤습니다")).toBeVisible();
  const in1 = bodies[1];
  expect(in1.threadId).toBe(in0.threadId);
  const toolMsg = in1.messages.find((m: any) => m.role === "tool");
  expect(toolMsg.toolCallId).toBe("call_ask");
  expect(JSON.parse(toolMsg.content).answers).toEqual({ purpose: "워크숍 다과 구매", payer: "김○○", reimbursement: "needed" });
  expect(in1.messages.some((m: any) => m.role === "assistant" && m.toolCalls?.[0]?.id === "call_ask")).toBe(true);
  expect(in1.messages.some((m: any) => m.role === "activity")).toBe(false);
  expect(in1.state.locked).toEqual(expect.arrayContaining(["purpose", "payer", "reimbursement"]));
  expect(in1.state.locked).not.toContain("amount");
  expect(in1.state.asks).toBe(1);
  await expect(page.locator("#f-summary")).toHaveValue(summary);
  await expect(page.getByTestId("bundle")).toContainText("11/18 · 행사 다과 · 26,400원");
  await expect(page.getByTestId("bundle")).toContainText("자원봉사자 워크숍 · 회의·행사비");
  await expect(page.getByText("환급 이체 확인증을 함께 보관하세요.")).toBeVisible();
  await expect(page.getByText("날짜 미상")).toBeVisible();
  await expect(page.getByRole("link", { name: "출처 1" })).toHaveAttribute("href", "https://example.go.kr/guide");

  if (process.env.SHOTS) await page.screenshot({ path: `test-results/shot-3-done.png`, fullPage: true });
  // 사람이 확정해야 저장된다
  await page.getByRole("button", { name: "내용 확정" }).click();
  await expect(page.getByTestId("saved-line")).toContainText("11/18 · 행사 다과 · 26,400원");
  await expect(page.getByTestId("saved-line")).toContainText("승인 대기");
  await page.getByRole("button", { name: "검토 목록 보기" }).click();

  // 검토: 보완 2건, 승인, 마감 점검 에이전트
  await expect(page.getByText("보완이 필요한 2건")).toBeVisible();
  await page.getByRole("button", { name: "승인", exact: true }).click();
  await expect(page.getByText("보완이 필요한 1건")).toBeVisible();
  await page.getByRole("button", { name: "마감 점검 맡기기" }).click();
  await expect(page.getByTestId("briefing")).toContainText("56,900원");
  await expect(page.getByText("이체확인증을 금요일까지 첨부해 주세요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "문안 복사" })).toBeVisible();
  if (process.env.SHOTS) await page.screenshot({ path: `test-results/shot-4-review.png`, fullPage: true });

  // 결산보고서
  await page.getByRole("button", { name: "결산보고서 보기" }).click();
  await expect(page.locator("#report-total")).toHaveText("56,900원");
  if (process.env.SHOTS) await page.screenshot({ path: `test-results/shot-5-report.png`, fullPage: true });
  await expect(page.locator("main")).toContainText("지원사업 회계 처리 안내");
  await expect(page.getByRole("link", { name: "원문 열기" }).first()).toHaveAttribute("href", "https://example.go.kr/guide");
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV 내려받기" }).click()]);
  expect(csv.suggestedFilename()).toContain(".csv");
  const [rep] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "보고서 내려받기" }).click()]);
  expect(rep.suggestedFilename()).toContain("결산보고서");
  expect(await page.content()).not.toMatch(/부적법|위반입니다/);

  await page.reload();
  await expect(page.getByText("56,900원")).toBeVisible();
});

test("에이전트 실패 시 직접 입력으로 저장할 수 있다", async ({ page }) => {
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: sseBody(started, { type: "RUN_ERROR", message: "Liner 크레딧이 부족합니다. 직접 입력으로 계속할 수 있습니다.", code: "insufficient_quota" }) }));
  await toMask(page);
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await expect(page.locator('.astryx-banner[data-status="error"]')).toContainText("직접 입력");
  await page.getByRole("button", { name: "직접 입력으로 계속" }).click();
  await page.locator("#f-date").fill("2026-11-18");
  await page.locator("#f-amount").fill("26400");
  await page.locator("#f-item").fill("행사 다과");
  await page.locator("#f-pay").click();
  await page.getByRole("option", { name: "개인 선결제" }).click();
  await page.locator("#f-project").fill("자원봉사자 워크숍");
  await page.locator("#q-payer").fill("김○○");
  await page.getByRole("radio", { name: "환급 필요" }).click();
  await page.getByRole("button", { name: "내용 확정" }).click();
  await expect(page.getByTestId("saved-line")).toContainText("승인 대기");
});

test("영수증이 없으면 사유 없이는 증빙 보완, 사유를 넣으면 해소", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "검토 목록" }).click();
  await page.getByRole("button", { name: "보완", exact: true }).click();
  await page.locator("#alt-reason").fill("강사 계좌로 직접 이체, 이체확인증 추후 첨부");
  await page.getByRole("button", { name: "저장" }).click();
  await expect(page.getByText("증빙을 보완했습니다.")).toBeVisible();
  await expect(page.getByText("승인 대기")).toBeVisible();
});

test("처음 방문: 소개를 보고 우리 단체로 시작한 뒤 직접 기록을 남긴다", async ({ page }) => {
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: sseBody(started, { type: "RUN_ERROR", message: "Liner 크레딧이 부족합니다. 직접 입력으로 계속할 수 있습니다." }) }));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "지출 한 건마다 증빙 묶음을 완성합니다" })).toBeVisible();
  await expect(page.getByText("에이전트는 판정하지 않습니다")).toBeVisible();
  // 필수 값 없이 시작하면 무엇이 빠졌는지 알려 준다
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(page.locator('.astryx-banner[data-status="error"]')).toContainText("단체 이름");
  await page.locator("#s-org").fill("다온 나눔모임");
  await page.locator("#s-submitter").fill("김다온");
  await page.locator("#s-approver").fill("박대표");
  await page.locator("#s-project").fill("겨울 캠프");
  await page.getByRole("button", { name: "시작하기" }).click();
  await expect(page.getByText("다온 나눔모임 · 김다온")).toBeVisible();
  await expect(page.getByText("이 사업에는 아직 기록이 없습니다.")).toBeVisible();

  // 영수증 없이 직접 입력
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "영수증이 없어요" }).click();
  await page.locator("#alt-reason").fill("현장 현금 결제로 영수증 미발급");
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.locator("#f-date").fill("2026-12-20");
  await page.locator("#f-amount").fill("15000");
  await page.locator("#f-item").fill("캠프 간식");
  await page.locator("#f-pay").click();
  await page.getByRole("option", { name: "현금" }).click();
  await page.locator("#f-project").fill("겨울 캠프");
  await page.getByRole("button", { name: "내용 확정" }).click();
  await expect(page.getByTestId("saved-line")).toContainText("12/20 · 캠프 간식 · 15,000원");
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await expect(page.getByText("대표 박대표")).toBeVisible();
  await page.getByRole("button", { name: "승인", exact: true }).click();

  // 새로고침해도 소개가 다시 뜨지 않고 기록과 설정이 남아 있다
  await page.reload();
  await expect(page.getByText("다온 나눔모임 · 김다온")).toBeVisible();
  await expect(page.getByText("15,000원").first()).toBeVisible();

  // 기록 상세 → 수정하면 다시 승인 대기 → 삭제
  await page.getByText("캠프 간식").click();
  await expect(page.getByTestId("detail")).toContainText("승인 박대표");
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.locator("#f-amount").fill("18000");
  await page.getByRole("button", { name: "내용 확정" }).click();
  await expect(page.getByTestId("saved-line")).toContainText("18,000원");
  await expect(page.getByTestId("saved-line")).toContainText("승인 대기");
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByText("캠프 간식").click();
  await expect(page.getByTestId("history")).toContainText("승인했습니다");
  await expect(page.getByTestId("history")).toContainText("승인된 기록을 고쳐 승인이 풀렸습니다 (이전 승인: 박대표)");
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인" }).click();
  await expect(page.getByText("캠프 간식 건을 삭제했습니다.")).toBeVisible();
  await expect(page.getByText("이 사업에는 아직 기록이 없습니다.")).toBeVisible();
});

test("보고서 공유: 이름을 가린 링크를 만들어 다른 창에서 읽기 전용으로 본다", async ({ page, context }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.locator("#report-total")).toHaveText("30,500원");
  await page.getByRole("button", { name: "공유 링크 만들기" }).click();
  const link = await page.locator("#share-link").inputValue();
  expect(link).toMatch(/\/r#[A-Za-z0-9_-]+$/);
  expect(link.length).toBeLessThan(4000);

  // 받는 사람: 저장된 기록이 없는 새 브라우저
  const other = await (await page.context().browser()!.newContext()).newPage();
  await other.goto(link);
  await expect(other.getByRole("heading", { name: "자원봉사자 워크숍 결산보고서" })).toBeVisible();
  await expect(other.locator("#report-total")).toHaveText("30,500원");
  await expect(other.locator("main")).toContainText("다온 나눔모임 (가상)에서 공유한 보고서 초안입니다.");
  await expect(other.locator("main")).toContainText("이름 가림");
  await expect(other.locator("main")).toContainText("교통비");
  await expect(other.locator("main")).not.toContainText("김○○");
  await expect(other.getByRole("button", { name: "CSV 내려받기" })).toHaveCount(0);

  // 요약만 공유하면 건별 내역이 빠진다
  await page.getByRole("radio", { name: "요약만" }).click();
  await page.getByRole("button", { name: "공유 링크 만들기" }).click();
  const link2 = await page.locator("#share-link").inputValue();
  expect(link2).not.toBe(link);
  await other.goto(link2);
  await other.reload();
  await expect(other.locator("#report-total")).toHaveText("30,500원");
  await expect(other.locator("main")).toContainText("요약만");
  await expect(other.locator("main")).not.toContainText("4. 지출 내역");

  // 깨진 링크
  await other.goto(new URL("/r#broken", link).href);
  await other.reload();
  await expect(other.getByText("보고서를 열 수 없습니다")).toBeVisible();
});

/** 직접 동기화하고, 그 동기화가 끝날 때까지 기다린다 (진행 중이던 동기화가 있으면 그 뒤에 한 번 더 돈다). */
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 60_000 }).toBeGreaterThan(before);
}

test("단체 공간은 가만히 두면 서버를 계속 부르지 않는다", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("radio", { name: "열림" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  await page.waitForTimeout(4000); // 뒤따르는 자동 동기화가 끝나기를 기다린다
  let calls = 0;
  page.on("request", (r) => { if (r.url().includes("/api/sync/")) calls++; });
  await page.waitForTimeout(8000);
  expect(calls).toBe(0);
});

test("단체 공간: 총무가 초대 링크를 보내고, 승인자가 다른 기기에서 승인하면 총무 기기에 반영된다", async ({ page, browser }) => {
  test.setTimeout(120_000);
  // 총무 기기: 데모로 시작해 승인 대기 건을 하나 만든다
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "영수증이 없어요" }).click();
  await page.locator("#alt-reason").fill("현장 현금 결제로 영수증 미발급");
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.locator("#f-date").fill("2026-11-20");
  await page.locator("#f-amount").fill("9000");
  await page.locator("#f-item").fill("현수막 끈");
  await page.locator("#f-pay").click();
  await page.getByRole("option", { name: "현금" }).click();
  await page.locator("#f-project").fill("자원봉사자 워크숍");
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();

  // 단체 공간을 만들고 초대 링크를 얻는다
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 20_000 });
  const invite = await page.locator("#invite-link").inputValue();
  expect(invite).toMatch(/\/app#join=[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}$/);
  await expect(page.getByTestId("workspace")).toContainText(/동기화했습니다|마지막 동기화/, { timeout: 20_000 });

  // 단체 공간에서는 등록자 기기에 승인 버튼이 없다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "검토 목록" }).click();
  await expect(page.getByTestId("no-approve").first()).toHaveText("승인자가 승인합니다");
  await expect(page.getByRole("button", { name: "승인", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "설정" }).click();

  // 승인자 기기: 기록이 없는 새 브라우저에서 초대 링크를 연다
  const other = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR" })).newPage();
  await other.goto(invite);
  await expect(other.getByRole("heading", { name: "초대받은 단체 공간에 참여합니다" })).toBeVisible();
  await other.getByRole("button", { name: "참여하기" }).click();
  await expect(other.locator('.astryx-banner[data-status="error"]')).toContainText("내 이름");
  await other.locator("#j-name").fill("박승인");
  await other.getByRole("radio", { name: "승인하는 사람" }).click();
  await other.getByRole("button", { name: "참여하기" }).click();
  await expect(other.getByText("현수막 끈")).toBeVisible({ timeout: 20_000 });
  await expect(other.getByText("다온 나눔모임 (가상) · 박승인")).toBeVisible();
  expect(other.url()).not.toContain("join=");

  // 승인자가 승인한다 → 자기 이름으로 기록된다
  await other.getByRole("button", { name: "검토 목록" }).click();
  await expect(other.getByText("승인자 박승인")).toBeVisible();
  await other.getByRole("button", { name: "승인", exact: true }).click();
  await other.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(other);

  // 총무 기기에서 동기화하면 승인이 보인다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  await page.getByText("현수막 끈").click();
  await expect(page.getByTestId("detail")).toContainText("승인 박승인");
  // 서명 원장: 올린 기기와 다른, 승인자 역할의 기기가 서명했음을 총무 기기가 검증한다
  await expect(page.getByTestId("detail")).toContainText(/올린 서명김○○ 기기 · 열쇠 [0-9a-f]{8}/);
  await expect(page.getByTestId("detail")).toContainText(/승인 서명박승인 기기 · 열쇠 [0-9a-f]{8}/);
  await expect(page.getByTestId("approval-audit")).toHaveCount(0);

  // 총무가 지우면 승인자 기기에서도 사라진다
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인" }).click();
  await syncDevice(page);
  await syncDevice(other);
  await expect(other.getByText("현수막 끈")).toHaveCount(0);

  // 두 기기가 같은 원장 사본을 갖는다: 기기 2대, 같은 지문, 검증 문제 없음
  await page.getByRole("button", { name: "설정" }).click();
  await other.getByRole("button", { name: "설정" }).click();
  await expect(page.locator("#ledger-size")).toContainText("기기 2대");
  await expect(page.getByTestId("ledger-member")).toHaveCount(2);
  await expect(page.getByTestId("ledger")).toContainText("김○○ (이 기기)");
  await expect(other.getByTestId("ledger")).toContainText("박승인 (이 기기)");
  await expect(other.getByTestId("ledger")).toContainText("승인하는 사람");
  const head = (await page.locator("#ledger-head").textContent())!;
  expect(head).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  await expect(other.locator("#ledger-head")).toHaveText(head);
  await expect(page.getByTestId("ledger-problem")).toHaveCount(0);
  await expect(other.getByTestId("ledger")).toContainText("받은 원장을 모두 검증했습니다");
});

test("개발자 안내: 엔드포인트와 예제를 보여 주고, 직접 실행해 이벤트와 결과를 확인한다", async ({ page }) => {
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: sseBody(
    started,
    act("update_record", "기록을 채웠습니다", "금액, 항목, 결제 방식"),
    { type: "STATE_SNAPSHOT", snapshot: { record: { amount: 26400, item: "워크숍 다과", paymentMethod: "personal" }, summary: "워크숍 다과 26,400원을 개인 카드로 결제했습니다.", checklist: [] } },
    finished({ result: { status: "done" } }),
  ) }));
  await page.goto("/developers");
  await expect(page.getByRole("heading", { name: "열린영수증 에이전트를 내 서비스에서 부르기" })).toBeVisible();
  const origin = new URL(page.url()).origin;
  await expect(page.locator("main")).toContainText(`${origin}/api/agent/expense`);
  await expect(page.locator("main")).toContainText(`${origin}/api/agent/close`);
  await expect(page.locator("main")).toContainText("npm install @ag-ui/client");
  await expect(page.locator("main")).toContainText("pendingToolCallIds");
  await expect(page.getByRole("link", { name: "HttpAgent 문서" })).toHaveAttribute("href", "https://docs.ag-ui.com/sdk/js/client/http-agent");

  await page.getByRole("button", { name: "실행", exact: true }).click();
  await expect(page.locator("main")).toContainText("ACTIVITY_SNAPSHOT · 기록을 채웠습니다");
  await expect(page.locator("main")).toContainText("RUN_FINISHED");
  await expect(page.locator("main")).toContainText('"amount": 26400');

  // 앱에서 들어오는 길
  await page.goto("/app");
  await page.getByRole("link", { name: "개발자 안내 (에이전트 API)" }).click();
  await expect(page).toHaveURL(/\/developers$/);
});

test("영수증 보기와 역할별 공유: 등록자·승인자는 원본까지, 후원자는 결산보고서와 가린 영수증만", async ({ page, browser }) => {
  test.setTimeout(180_000);
  let n = 0;
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: n++ === 0 ? askTurn : doneTurn }));

  // 등록자: 영수증을 올려 기록을 만든다
  await toMask(page);
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "가림 상자 추가" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.locator("#q-purpose").fill("워크숍 다과 구매");
  await page.locator("#q-payer").fill("김○○");
  await page.getByRole("radio", { name: "환급 필요" }).click();
  await page.getByRole("button", { name: "답하고 계속" }).click();
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "검토 목록 보기" }).click();

  // 결산보고서에서 가린 영수증과 원본을 모두 볼 수 있다
  await page.getByRole("button", { name: "결산보고서 보기" }).click();
  await expect(page.getByRole("heading", { name: "8. 영수증" })).toBeVisible();
  const receipt = page.getByTestId("receipt");
  await expect(receipt).toHaveCount(1);
  await expect(receipt).toContainText("2026-11-18 · 행사 다과 · 26,400원");
  await expect(receipt.getByAltText(/가린 영수증/)).toBeVisible();
  const maskedSrc = await receipt.locator("img").getAttribute("src");
  await receipt.getByRole("radio", { name: "원본" }).click();
  await expect(receipt.getByAltText(/원본 영수증/)).toBeVisible();
  const originalSrc = await receipt.locator("img").getAttribute("src");
  expect(originalSrc).not.toBe(maskedSrc);
  expect(originalSrc).toMatch(/^data:image\/jpeg;base64,/);

  // 단체 공간을 만들고 후원자용 보기를 연다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 30_000 });
  const invite = await page.locator("#invite-link").inputValue();
  await page.getByRole("radio", { name: "열림" }).click();
  await expect(page.locator("#viewer-link")).toHaveValue(/\/v#[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}$/);
  const viewerLink = await page.locator("#viewer-link").inputValue();
  expect(viewerLink).not.toContain(invite.split(".").pop()!); // 후원자 링크에는 구성원 열쇠가 없다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);

  // 승인자: 다른 기기에서 참여하면 결산보고서에서 원본까지 본다
  const mobile = { viewport: { width: 390, height: 844 }, locale: "ko-KR" };
  const approver = await (await browser.newContext(mobile)).newPage();
  await approver.goto(invite);
  await approver.locator("#j-name").fill("박승인");
  await approver.getByRole("radio", { name: "승인하는 사람" }).click();
  await approver.getByRole("button", { name: "참여하기" }).click();
  await expect(approver.getByText("행사 다과")).toBeVisible({ timeout: 30_000 });
  await syncDevice(approver);
  await approver.getByRole("button", { name: "결산보고서" }).click();
  const aReceipt = approver.getByTestId("receipt");
  await expect(aReceipt.getByAltText(/가린 영수증/)).toBeVisible();
  await aReceipt.getByRole("radio", { name: "원본" }).click();
  await expect(aReceipt.getByAltText(/원본 영수증/)).toBeVisible({ timeout: 20_000 });
  expect(await aReceipt.locator("img").getAttribute("src")).toBe(originalSrc);

  // 후원자: 링크만으로 결산보고서와 가린 영수증을 본다. 원본·이름·수정 기능은 없다
  const sponsor = await (await browser.newContext(mobile)).newPage();
  await sponsor.goto(viewerLink);
  await expect(sponsor.getByRole("heading", { name: "자원봉사자 워크숍 결산보고서" })).toBeVisible({ timeout: 30_000 });
  await expect(sponsor.locator("#report-total")).toHaveText("56,900원");
  await expect(sponsor.locator("main")).toContainText("후원자께 공유한 결산보고서입니다.");
  await expect(sponsor.locator("main")).toContainText("이름 가림");
  const sReceipt = sponsor.getByTestId("receipt");
  await expect(sReceipt).toHaveCount(1);
  await expect(sReceipt.getByAltText(/가린 영수증/)).toBeVisible({ timeout: 20_000 });
  expect(await sReceipt.locator("img").getAttribute("src")).toBe(maskedSrc);
  await expect(sponsor.getByRole("radio", { name: "원본" })).toHaveCount(0);
  await expect(sponsor.locator("main")).not.toContainText("김○○");
  await expect(sponsor.getByRole("button", { name: /승인|수정|삭제|지출 추가/ })).toHaveCount(0);
  // 변조 확인용 지문: 단체가 보는 보고서의 지문과 같다
  const print1 = (await sponsor.locator("#report-print").textContent())!;
  expect(print1).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  await expect(approver.locator("#report-print")).toHaveText(print1);
  await expect(sponsor.getByTestId("proof")).toContainText(/기기 \d대/);
  await expect(sponsor.getByTestId("proof-changed")).toHaveCount(0);

  // 승인자가 승인하면 후원자 화면에도 반영된다
  await approver.getByRole("button", { name: "검토 목록으로" }).click();
  await approver.getByRole("button", { name: "승인", exact: true }).click();
  await approver.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(approver);
  await sponsor.getByRole("button", { name: "새로 고침" }).click();
  await expect(sponsor.locator("main")).toContainText("승인 완료", { timeout: 20_000 });
  // 기록이 바뀌었으므로 지문이 달라지고, 후원자에게 지난번과 달라졌다고 알린다
  await expect(sponsor.getByTestId("proof-changed")).toContainText(print1);
  await expect(sponsor.locator("#report-print")).not.toHaveText(print1);

  // 후원자용 보기를 닫으면 링크로 더 볼 수 없다
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("radio", { name: "닫힘" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  await sponsor.getByRole("button", { name: "새로 고침" }).click();
  await expect(sponsor.getByText("단체에서 후원자용 보기를 닫았습니다.").first()).toBeVisible({ timeout: 20_000 });
});

test("영수증 여러 장 올리기: 한꺼번에 올리면 에이전트가 한 장씩 초안으로 정리하고, 한꺼번에 확정한다", async ({ page }) => {
  const { readFileSync } = await import("node:fs");
  const png = readFileSync("public/demo-receipt.png");
  const bodies: any[] = [];
  await page.route("**/api/agent/expense", async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    const i = bodies.length;
    // 세 번째 영수증은 금액을 읽지 못한 것으로 한다
    const record = { ...body.state.record, date: `2026-11-2${i}`, item: `준비물 ${i}`, paymentMethod: "org_card", ...(i === 3 ? {} : { amount: 1000 * i }) };
    await route.fulfill({ ...ndjson, body: sseBody(started, act("update_record", "기록을 채웠습니다"), { type: "STATE_SNAPSHOT", snapshot: { ...body.state, record, aiFields: ["date", "item", "paymentMethod", "amount"], summary: `준비물 ${i} 구입.`, checklist: [], sources: [] } }, finished()) });
  });
  // 올리기가 끝나면 묶음 에이전트가 한 번 돈다. 여기서는 묶을 것이 없다고 답한다.
  const groupBodies: any[] = [];
  await page.route("**/api/agent/group", async (route) => {
    groupBodies.push(route.request().postDataJSON());
    await route.fulfill({ ...ndjson, body: groupTurn(groupBodies.at(-1).state.documents) });
  });
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "영수증 여러 장 올리기" }).click();
  await page.locator("#bulk-files").setInputFiles(["a.png", "b.png", "c.png"].map((name) => ({ name, mimeType: "image/png", buffer: png })));
  await expect(page.getByTestId("bulk-list")).toContainText("c.png");
  // 한 장은 가린다
  await page.getByRole("button", { name: "가리기" }).first().click();
  const box = (await page.locator(".maskwrap").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.8);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9, { steps: 4 });
  await page.mouse.up();
  await page.getByRole("button", { name: "가림 완료" }).click();
  await expect(page.getByTestId("bulk-list")).toContainText("가린 상자 1개");
  await page.locator("#bulk-memo").fill("11월 워크숍 준비물");
  await page.getByRole("button", { name: "3장 에이전트에게 맡기기" }).click();
  await expect(page.getByText("3장을 초안으로 정리했습니다.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("bulk-list")).toContainText("확인 필요: 금액");
  await expect(page.getByTestId("group-card")).toContainText("한 거래로 묶을 서류를 찾지 못했습니다.");
  expect(groupBodies).toHaveLength(1);
  expect(groupBodies[0].state.documents).toHaveLength(3);
  expect(JSON.stringify(groupBodies[0])).not.toContain("data:image"); // 사진은 보내지 않는다

  // 요청: 한 장씩, 가린 사진과 공통 메모, 사업은 미리 정해 잠금, 질문 도구 없음
  expect(bodies).toHaveLength(3);
  for (const b of bodies) {
    expect(b.messages[0].content[0].text).toBe("11월 워크숍 준비물");
    expect(b.messages[0].content[1]).toMatchObject({ type: "image", source: { mimeType: "image/jpeg" } });
    expect(b.state.record.project).toBe("자원봉사자 워크숍");
    expect(b.state.locked).toContain("project");
    expect(b.tools).toEqual([]);
  }

  // 초안으로 저장되고, 필수 정보가 채워진 두 건만 한꺼번에 확정된다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await expect(page.getByText("초안", { exact: true })).toHaveCount(3);
  await page.getByRole("button", { name: "초안 2건 한꺼번에 확정" }).click();
  await expect(page.getByText("2건을 확정했습니다.")).toBeVisible();
  await expect(page.getByText("승인 대기", { exact: true })).toHaveCount(2);
  await expect(page.getByText("초안", { exact: true })).toHaveCount(1);

  // 남은 초안은 검토 목록에서 수정해 마무리한다
  await page.getByRole("button", { name: "검토 목록" }).click();
  await expect(page.getByText("필수 정보 입력: 금액")).toBeVisible();
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.locator("#f-amount").fill("3000");
  await page.getByRole("button", { name: "내용 확정" }).click();
  await expect(page.getByTestId("saved-line")).toContainText("승인 대기");

  // 새로고침해도 사진 다섯 건이 남고, 결산보고서에 영수증 세 장이 보인다
  await page.reload();
  await page.getByRole("button", { name: "결산보고서" }).click();
  await expect(page.locator("#report-total")).toHaveText("36,500원");
  await expect(page.getByTestId("receipt")).toHaveCount(3);
  await expect(page.getByTestId("receipt").first().getByAltText(/가린 영수증/)).toBeVisible();
});

test("소개 페이지: 처음 보는 사람에게 취지와 사용법을 보여 주고, 출시 알림을 신청·취소할 수 있다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "행사가 끝나면, 영수증만 올리세요" })).toBeVisible();
  const main = page.locator("main");
  // 시연 영상: 누르기 전에는 대표 그림만 받고, 영상 파일은 실제로 열린다
  const demo = page.getByTestId("demo-video");
  await expect(demo).toHaveAttribute("poster", "/demo/poster.jpg");
  await expect(demo).toHaveAttribute("preload", "none");
  for (const src of ["/demo/poster.jpg", "/demo/open-receipt-demo.mp4"]) expect((await page.request.head(src)).status(), src).toBe(200);
  for (const text of ["행사가 끝난 뒤 정산", "월말 보고", "연말 결산과 후원자 보고", "AG-UI 프로토콜", "GNU 일반 공중 사용 허가서(GPL)", "공익을 위한 도구로 쓰겠습니다", "판정하지 않습니다"]) await expect(main).toContainText(text);
  // 실제 앱 화면 사진이 단계별로 들어 있고 모두 불러와진다
  await expect(page.locator(".lp-step")).toHaveCount(7);
  const shots = page.locator(".lp-phone img");
  await expect(shots).toHaveCount(10);
  await page.evaluate(async () => {
    for (const img of Array.from(document.images)) { img.loading = "eager"; if (!img.complete) await new Promise((r) => { img.onload = r; img.onerror = r; }); }
  });
  expect(await shots.evaluateAll((imgs) => imgs.every((i) => (i as HTMLImageElement).naturalWidth > 300 && !!(i as HTMLImageElement).alt))).toBe(true);
  // 휴대폰 폭에서 가로로 넘치지 않는다
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // 출시 알림: 잘못된 입력은 이유를 알려 주고, 동의해야 신청된다
  await page.getByRole("button", { name: "출시 알림 신청" }).click();
  await expect(page.locator('.astryx-banner[data-status="error"]')).toContainText("이메일 주소를 확인해 주세요");
  const email = `tester+${Date.now()}@example.org`;
  await page.locator("#wl-email").fill(email);
  await page.getByRole("button", { name: "출시 알림 신청" }).click();
  await expect(page.locator('.astryx-banner[data-status="error"]')).toContainText("동의해 주세요");
  await page.locator("#wl-org").fill("다온 나눔모임");
  await page.locator("#wl-consent").check();
  await page.getByRole("button", { name: "출시 알림 신청" }).click();
  await expect(page.getByTestId("waitlist-done")).toContainText("정식으로 출시하면");
  await expect(page.getByTestId("waitlist-done")).toContainText(email);
  // 신청 취소 → 이메일 삭제
  await page.getByRole("button", { name: "신청 취소 (이메일 삭제)" }).click();
  await expect(main).toContainText("저장된 이메일을 삭제했습니다.");

  // 앱으로 가는 길, 예전 초대 링크는 앱으로 넘긴다
  await page.getByRole("link", { name: "지금 써 보기" }).first().click();
  await expect(page).toHaveURL(/\/app$/);
  await page.goto("/#join=AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  await expect(page).toHaveURL(/\/app#join=/);
  await expect(page.getByRole("heading", { name: "초대받은 단체 공간에 참여합니다" })).toBeVisible();
});

test("중복 경고: 날짜와 금액이 같은 기록이 있으면 확정 전에 알리고, 목록과 검토에도 표시한다", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "영수증이 없어요" }).click();
  await page.locator("#alt-reason").fill("영수증 분실");
  await page.getByRole("button", { name: "직접 입력", exact: true }).click();
  await page.locator("#f-date").fill("2026-11-18");
  await page.locator("#f-amount").fill("17000");
  await page.locator("#f-item").fill("안내문 인쇄");
  await expect(page.getByTestId("dup-warning")).toHaveCount(0);
  // 데모의 인쇄물 18,000원(11/18)과 날짜·금액이 같아진다
  await page.locator("#f-amount").fill("18000");
  await expect(page.getByTestId("dup-warning")).toContainText("인쇄물 18,000원");
  await page.locator("#f-pay").click();
  await page.getByRole("option", { name: "현금" }).click();
  await page.locator("#f-project").fill("자원봉사자 워크숍");
  // 경고는 막지 않는다. 확정하면 목록과 검토에 표시가 남는다.
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await expect(page.getByTestId("dup-review")).toContainText("2건");
  await expect(page.getByText(/· 중복 확인$/)).toHaveCount(2);
  await page.getByText("안내문 인쇄").first().click();
  await expect(page.getByTestId("dup-warning")).toContainText("인쇄물 18,000원");
});

test("서명 원장: 혼자 쓰는 기기도 기록마다 서명을 남기고, 공유 링크에 지문이 실린다", async ({ page, context }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  // 데모 기록 2건을 이 기기가 서명했다
  await expect(page.locator("#ledger-size")).toHaveText("2줄 · 기기 1대");
  const head1 = (await page.locator("#ledger-head").textContent())!;
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByText("인쇄물").click();
  await expect(page.getByTestId("detail")).toContainText(/서명김○○ 기기 · 열쇠 [0-9a-f]{8}/);
  // 고치면 원장에 줄이 늘고 지문이 바뀐다
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await page.locator("#f-amount").fill("19000");
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "결산보고서 보기" }).click();
  const print = (await page.locator("#report-print").textContent())!;
  expect(print).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  await page.getByRole("button", { name: "공유 링크 만들기" }).click();
  const link = await page.locator("#share-link").inputValue();
  const other = await context.newPage();
  await other.goto(link);
  await expect(other.locator("#report-print")).toHaveText(print);
  await expect(other.getByTestId("proof")).toContainText("3줄 · 기기 1대");
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await expect(page.locator("#ledger-size")).toHaveText("3줄 · 기기 1대");
  await expect(page.locator("#ledger-head")).not.toHaveText(head1);
  // 새로고침해도 열쇠와 원장이 남는다
  await page.reload();
  await page.getByRole("button", { name: "설정" }).click();
  await expect(page.locator("#ledger-size")).toHaveText("3줄 · 기기 1대");

  // 앱을 거치지 않고 저장소의 금액을 몰래 고치면, 그 내용에 서명한 기기가 없다고 드러난다
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem("open-receipt:v1")!);
    list.find((e: any) => e.item === "인쇄물").amount = 190000;
    localStorage.setItem("open-receipt:v1", JSON.stringify(list));
  });
  await page.reload();
  await page.getByText("인쇄물").click();
  await expect(page.getByTestId("detail")).toContainText("190,000원");
  await expect(page.getByTestId("detail")).toContainText("지금 내용에 서명한 기기가 없습니다");
});
