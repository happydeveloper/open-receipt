// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시연 영상용 화면 녹화. RECORD_VIDEO=1일 때만 실행 (실제 Liner 호출, 크레딧 사용).
 *   node video/tts.mjs                                   # 내레이션 음성과 길이
 *   RECORD_VIDEO=1 BASE_URL=https://open-receipt-six.vercel.app npx playwright test e2e/video-record.spec.ts
 *
 * 등록자, 승인자, 후원자 세 기기의 화면을 따로 녹화하고, 대본(video/script.json)의 문장마다
 * 그 장면이 영상의 몇 초부터 몇 초까지인지를 video/raw/timeline.json에 적는다.
 * 에이전트 응답은 가짜가 아니라 실제 Liner가 돌려준 것이다. 단체와 서류는 모두 가상 자료다.
 * 장면마다 내레이션이 끝날 때까지 화면을 붙잡아 두므로, 편집에서 속도를 바꾸지 않아도 말과 화면이 맞는다.
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { draw, sheets } from "./papers";

test.skip(!process.env.RECORD_VIDEO, "RECORD_VIDEO=1일 때만 실행");

const RAW = "video/raw";
const SIZE = { width: 450, height: 900 };
const durations: Record<string, number> = JSON.parse(readFileSync(`${RAW}/durations.json`, "utf8"));
interface Dev { name: string; page: Page; t0: number }
interface Mark { id: string; dev: string; from: number; to: number }
const marks: Mark[] = [];

async function device(browser: Browser, name: string): Promise<Dev> {
  const ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 2, locale: "ko-KR", recordVideo: { dir: RAW, size: { width: SIZE.width * 2, height: SIZE.height * 2 } } });
  const page = await ctx.newPage();
  return { name, page, t0: Date.now() };
}
/** 장면 하나. 내레이션 길이보다 짧게 끝나면 남은 시간만큼 화면을 붙잡아 둔다. */
async function scene(dev: Dev, id: string, fn: () => Promise<void>) {
  const from = Date.now() - dev.t0;
  await fn();
  const need = (durations[id] ?? 3) * 1000 + 500;
  const spent = Date.now() - dev.t0 - from;
  await dev.page.waitForTimeout(Math.max(700, need - spent));
  marks.push({ id, dev: dev.name, from, to: Date.now() - dev.t0 });
}
/** 누를 곳에 빨간 테두리를 잠깐 보여 준 뒤 누른다. */
async function ring(page: Page, target: Locator, ms = 800) {
  await target.evaluate((el: HTMLElement) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  await page.waitForTimeout(450);
  await target.evaluate((el: HTMLElement) => {
    const b = el.getBoundingClientRect(), pad = 5, edge = 3;
    const left = Math.max(edge, b.left - pad), top = Math.max(edge, b.top - pad);
    const right = Math.min(window.innerWidth - edge, b.right + pad), bottom = Math.min(window.innerHeight - edge, b.bottom + pad);
    const d = document.createElement("div");
    d.id = "video-ring";
    d.style.cssText = `position:fixed;z-index:99999;pointer-events:none;box-sizing:border-box;border:4px solid #e5484d;border-radius:12px;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px`;
    document.body.appendChild(d);
  });
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.getElementById("video-ring")?.remove());
}
async function tap(page: Page, target: Locator) {
  await ring(page, target);
  await target.click();
  await page.waitForTimeout(500);
}
const type = (target: Locator, text: string) => target.pressSequentially(text, { delay: 45 });
const glide = (page: Page, y: number | "bottom") =>
  page.evaluate((to) => window.scrollTo({ top: to === "bottom" ? document.body.scrollHeight : to, behavior: "smooth" }), y).then(() => page.waitForTimeout(900));
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 60_000 }).toBeGreaterThan(before);
}

test("시연 영상 녹화", async ({ browser, baseURL }) => {
  test.setTimeout(900_000);
  mkdirSync(RAW, { recursive: true });
  const files: { name: string; mimeType: string; buffer: Buffer }[] = [];
  for (const [name, html] of sheets) files.push({ name, mimeType: "image/png", buffer: await draw(browser, html) });

  /* ---------- 등록자 ---------- */
  const sub = await device(browser, "submitter");
  const page = sub.page;
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).waitFor();

  await scene(sub, "r1", async () => {
    await page.waitForTimeout(1200);
    await tap(page, page.getByRole("button", { name: "데모 데이터 불러오기" }));
  });
  await scene(sub, "r2", async () => {
    await tap(page, page.getByRole("button", { name: "+ 지출 추가" }));
    await tap(page, page.getByRole("button", { name: "가상 영수증 사용" }));
    await page.getByAltText("올린 영수증 미리보기").waitFor();
  });
  await scene(sub, "r3", async () => {
    await tap(page, page.getByRole("button", { name: "다음: 가릴 부분 확인" }));
    const wrap = page.locator(".maskwrap");
    await wrap.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
    await page.waitForTimeout(700);
    const box = (await wrap.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height * 0.8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.9, { steps: 30 });
    await page.mouse.up();
  });
  const confirm = page.getByRole("button", { name: "내용 확정" });
  const answer = page.getByRole("button", { name: "답하고 계속" });
  const failed = page.locator('.astryx-banner[data-status="error"]');
  await scene(sub, "r4", async () => {
    await tap(page, page.getByRole("button", { name: "에이전트에게 맡기기" }));
    await expect(confirm.or(answer).or(failed)).toBeVisible({ timeout: 150_000 });
    await expect(failed).toHaveCount(0);
  });
  // 실제 모델이 무엇을 물을지는 그때마다 다르다. 나온 질문에만 답한다.
  let asked = false;
  for (let round = 0; round < 3 && !(await confirm.isVisible()); round++) {
    await scene(sub, round === 0 ? "r5" : `r5-${round}`, async () => {
      asked = true;
      await page.getByTestId("question").first().evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
      await page.waitForTimeout(900);
      const projectBtn = page.getByRole("button", { name: "자원봉사자 워크숍" });
      if (await projectBtn.count()) await tap(page, projectBtn.first());
      if (await page.locator("#q-purpose").count()) await type(page.locator("#q-purpose"), "워크숍 다과 구매");
      if (await page.locator("#q-budget").count()) await type(page.locator("#q-budget"), "회의·행사비");
      if (await page.locator("#q-payer").count()) {
        await type(page.locator("#q-payer"), "김○○");
        await page.getByRole("radio", { name: "환급 필요" }).click();
      }
      await page.waitForTimeout(600);
      await tap(page, answer);
    });
    await scene(sub, round === 0 ? "r6" : `r6-${round}`, async () => {
      await expect(confirm.or(answer).or(failed)).toBeVisible({ timeout: 150_000 });
      await expect(failed).toHaveCount(0);
    });
  }
  console.log("질문을 받았는가:", asked);
  await scene(sub, "r7", async () => {
    await glide(page, 0);
    await page.waitForTimeout(1500);
    await glide(page, "bottom");
    await page.waitForTimeout(2200);
    await tap(page, confirm);
  });

  // 서류 네 장을 한꺼번에
  await scene(sub, "r8", async () => {
    await tap(page, page.getByRole("button", { name: "검토 목록 보기" }));
    await tap(page, page.getByRole("button", { name: "지출 목록으로" }));
    await tap(page, page.getByRole("button", { name: "영수증 여러 장 올리기" }));
    await page.locator("#bulk-files").setInputFiles(files);
    await page.getByTestId("bulk-list").getByText("인쇄영수증.png").waitFor();
    await type(page.locator("#bulk-memo"), "모두 조직카드로 결제");
    await glide(page, 120);
  });
  await scene(sub, "r9", async () => {
    await tap(page, page.getByRole("button", { name: "4장 에이전트에게 맡기기" }));
    await page.getByTestId("bulk-list").evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
    await expect(page.getByText("4장을 초안으로 정리했습니다.")).toBeVisible({ timeout: 300_000 });
  });
  const group = page.getByTestId("group");
  await scene(sub, "r10", async () => {
    await page.getByTestId("group-card").evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
    await expect(group.first()).toBeVisible({ timeout: 150_000 });
    await group.first().evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  });
  console.log("묶음 제안:", (await page.getByTestId("group-card").innerText()).replace(/\n+/g, " | "));
  await scene(sub, "r11", async () => {
    await page.waitForTimeout(2500);
    await tap(page, group.first().getByRole("button", { name: "한 건으로 합치기" }));
    await expect(page.locator("main")).toContainText("한 건으로 합쳤습니다.");
    await glide(page, 0);
  });
  await scene(sub, "r12", async () => {
    await tap(page, page.getByRole("button", { name: "지출 목록으로" }));
    await page.waitForTimeout(1800);
    const all = page.getByRole("button", { name: /초안 \d+건 한꺼번에 확정/ });
    if (await all.count()) await tap(page, all);
  });

  // 단체 공간과 후원자용 보기
  let invite = "", viewerLink = "";
  await scene(sub, "r13", async () => {
    await tap(page, page.getByRole("button", { name: "설정" }));
    await tap(page, page.getByRole("button", { name: "단체 공간 만들기" }));
    await page.locator("#invite-link").waitFor({ timeout: 60_000 });
    invite = await page.locator("#invite-link").inputValue();
    await ring(page, page.locator("#invite-link"), 1500);
  });
  await scene(sub, "r14", async () => {
    await tap(page, page.getByRole("radio", { name: "열림" }));
    await page.locator("#viewer-link").waitFor();
    viewerLink = await page.locator("#viewer-link").inputValue();
    await ring(page, page.locator("#viewer-link"), 1500);
  });
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);

  /* ---------- 승인자 ---------- */
  const app = await device(browser, "approver");
  const ap = app.page;
  await ap.goto(invite);
  await ap.locator("#j-name").waitFor();
  await scene(app, "a1", async () => {
    await ap.waitForTimeout(1000);
    await type(ap.locator("#j-name"), "박대표");
    await tap(ap, ap.getByRole("radio", { name: "승인하는 사람" }));
    await tap(ap, ap.getByRole("button", { name: "참여하기" }));
    await ap.getByText("승인 대기").first().waitFor({ timeout: 60_000 });
  });
  await syncDevice(ap);
  await scene(app, "a2", async () => {
    await tap(ap, ap.getByText("승인 대기", { exact: true }).first());
    const receipt = ap.getByTestId("receipt").first();
    await receipt.locator("img").waitFor({ timeout: 30_000 });
    await receipt.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
    await ap.waitForTimeout(1500);
    if (await receipt.getByRole("radio", { name: "원본" }).count()) {
      await tap(ap, receipt.getByRole("radio", { name: "원본" }));
      await ap.waitForTimeout(1200);
    }
  });
  await scene(app, "a3", async () => {
    await ap.getByRole("button", { name: "지출 목록으로" }).evaluate((el: HTMLElement) => el.scrollIntoView({ block: "center" }));
    await ap.getByRole("button", { name: "지출 목록으로" }).click();
    await tap(ap, ap.getByRole("button", { name: "검토 목록" }));
    for (let i = 0; i < 3; i++) {
      const ok = ap.getByRole("button", { name: "승인", exact: true });
      if (!(await ok.count())) break;
      await tap(ap, ok.first());
      await ap.waitForTimeout(700);
    }
    await glide(ap, 0);
  });
  await ap.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(ap);

  /* ---------- 등록자: 마감 점검과 결산보고서 ---------- */
  await syncDevice(page);
  await scene(sub, "r15", async () => {
    await tap(page, page.getByRole("button", { name: "검토 목록" }));
    await tap(page, page.getByRole("button", { name: "마감 점검 맡기기" }));
    // 연결이 끊겨 실패하면 한 번 더 맡긴다 (실제 호출이라 가끔 있다).
    for (let i = 0; i < 3; i++) {
      await expect(page.getByTestId("briefing").or(failed)).toBeVisible({ timeout: 180_000 });
      if (await page.getByTestId("briefing").isVisible()) break;
      console.log("마감 점검 재시도:", await failed.innerText());
      await page.getByRole("button", { name: /마감 점검 맡기기|다시 점검/ }).click();
      await page.waitForTimeout(1500);
    }
    await expect(page.getByTestId("briefing")).toBeVisible();
  });
  console.log("브리핑:", await page.getByTestId("briefing").innerText());
  await scene(sub, "r16", async () => {
    await page.getByTestId("briefing").evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollBy({ top: 260, behavior: "smooth" }));
  });
  await scene(sub, "r17", async () => {
    await tap(page, page.getByRole("button", { name: "결산보고서 보기" }));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollBy({ top: 420, behavior: "smooth" }));
    await page.waitForTimeout(2000);
    await page.getByRole("heading", { name: "4. 지출 내역" }).evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
  });
  await scene(sub, "r18", async () => {
    await page.getByRole("heading", { name: "8. 영수증" }).evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
    await page.waitForTimeout(1800);
    await page.evaluate(() => window.scrollBy({ top: 700, behavior: "smooth" }));
    await page.waitForTimeout(1500);
    await ring(page, page.getByRole("button", { name: "보고서 내려받기" }), 1500);
  });
  console.log("결산 합계:", await page.locator("#report-total").innerText());

  /* ---------- 후원자 ---------- */
  const spo = await device(browser, "sponsor");
  const sp = spo.page;
  await sp.goto(viewerLink);
  await sp.locator("#report-total").waitFor({ timeout: 60_000 });
  await scene(spo, "s1", async () => {
    await sp.waitForTimeout(2500);
    await sp.evaluate(() => window.scrollBy({ top: 380, behavior: "smooth" }));
  });
  await scene(spo, "s2", async () => {
    await sp.getByRole("heading", { name: "8. 영수증" }).evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
    await sp.getByTestId("receipt").first().locator("img").waitFor({ timeout: 30_000 });
    await sp.waitForTimeout(1800);
    await sp.evaluate(() => window.scrollBy({ top: 650, behavior: "smooth" }));
    await sp.waitForTimeout(1500);
    await sp.evaluate(() => window.scrollBy({ top: 650, behavior: "smooth" }));
  });

  // 녹화를 닫고 파일 이름을 기기 이름으로 바꾼다
  for (const d of [sub, app, spo]) {
    const video = d.page.video()!;
    await d.page.context().close();
    renameSync(await video.path(), `${RAW}/${d.name}.webm`);
  }
  writeFileSync(`${RAW}/timeline.json`, JSON.stringify({ baseURL, size: SIZE, marks }, null, 2));
  console.log("장면", marks.length, "개 ·", marks.map((m) => `${m.id}:${((m.to - m.from) / 1000).toFixed(1)}s`).join(" "));
});
