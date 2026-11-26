// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시나리오: 무늬가 복잡해서 용량이 큰 사진을 올려도, 다른 기기와 후원자에게 전달된다.
 *
 *  1. 큰 사진을 영수증으로 올린다 (잡음으로 가득 찬 그림이라 1600px로 줄여도 서버 한도를 넘는다).
 *  2. 앱이 사진을 한도 안으로 줄여 저장한다.
 *  3. 단체 공간에 동기화하면 가린 사진, 원본, 후원자용 사진이 모두 서버에 올라가고, 올리지 못했다는 안내가 없다.
 *  4. 서버가 사진을 받지 않으면(여기서는 일부러 거절시킨다) 올린 사람에게 알린다.
 */
import { expect, test, type Page } from "@playwright/test";
import { doneTurn, ndjson } from "./mocks";

const MAX_PHOTO_CHARS = 1_400_000;

/** 잡음으로 채운 큰 JPEG. 압축이 잘 안 돼서 용량이 크다. */
async function noisyPhoto(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1800; c.height = 2400;
    const g = c.getContext("2d")!;
    const d = g.createImageData(c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = Math.random() * 255; d.data[i + 1] = Math.random() * 255; d.data[i + 2] = Math.random() * 255; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
    return c.toDataURL("image/jpeg", 0.92);
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}
async function syncDevice(p: Page) {
  const status = p.getByTestId("sync-status");
  const before = Number(await status.getAttribute("data-sync-count"));
  await p.getByRole("button", { name: "동기화", exact: true }).click();
  await expect.poll(async () => Number(await status.getAttribute("data-sync-count")), { timeout: 90_000 }).toBeGreaterThan(before);
}

test("큰 사진: 올릴 때 서버 한도에 맞게 줄여 전달하고, 서버가 받지 않으면 올린 사람에게 알린다", async ({ page }) => {
  test.setTimeout(240_000);
  await page.route("**/api/agent/expense", (route) => route.fulfill({ ...ndjson, body: doneTurn }));
  await page.goto("/app");
  await page.getByRole("button", { name: "데모 데이터 불러오기" }).click();

  // 1. 큰 사진을 올린다
  const photo = await noisyPhoto(page);
  expect(photo.length).toBeGreaterThan(3_000_000);
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.locator("#file").setInputFiles({ name: "noisy.jpg", mimeType: "image/jpeg", buffer: photo });
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "가림 상자 추가" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "검토 목록 보기" }).click();

  // 2. 저장된 사진은 한도 안이다
  await page.getByRole("button", { name: "결산보고서 보기" }).click();
  const src = (await page.getByTestId("receipt").locator("img").first().getAttribute("src"))!;
  expect(src.length).toBeGreaterThan(200_000); // 줄였어도 사진은 사진이다
  expect(src.length).toBeLessThanOrEqual(MAX_PHOTO_CHARS);

  // 3. 동기화하면 세 가지 사진이 모두 서버에 있다
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await page.getByRole("button", { name: "설정" }).click();
  await page.getByRole("button", { name: "단체 공간 만들기" }).click();
  await expect(page.locator("#invite-link")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("radio", { name: "열림" }).click();
  await expect(page.locator("#viewer-link")).toHaveValue(/\/v#/);
  const spaceId = (await page.locator("#viewer-link").inputValue()).split("#")[1].split(".")[0];
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  const id = await page.evaluate(() => (JSON.parse(localStorage.getItem("open-receipt:v1")!) as any[]).find((e) => e.item === "행사 다과").id);
  for (const kind of ["img", "orig", "view"]) await expect.poll(async () => (await page.request.get(`/api/sync/${spaceId}/img/${id}?kind=${kind}`)).status(), { message: kind, timeout: 60_000 }).toBe(200);
  await expect(page.locator("main")).not.toContainText("올리지 못했습니다");

  // 4. 서버가 사진을 받지 않으면 알린다 (새 사진을 올리는 요청을 일부러 거절시킨다)
  await page.route("**/api/sync/*/img/*", (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 413, contentType: "application/json", body: JSON.stringify({ error: "이미지가 너무 큽니다." }) }) : route.continue()));
  await page.getByRole("button", { name: "+ 지출 추가" }).click();
  await page.getByRole("button", { name: "가상 영수증 사용" }).click();
  await page.getByRole("button", { name: "다음: 가릴 부분 확인" }).click();
  await page.getByRole("button", { name: "에이전트에게 맡기기" }).click();
  await page.getByRole("button", { name: "내용 확정" }).click();
  await page.getByRole("button", { name: "검토 목록 보기" }).click();
  await page.getByRole("button", { name: "지출 목록으로" }).click();
  await syncDevice(page);
  await expect(page.locator("main")).toContainText(/사진 \d+장을 올리지 못했습니다/);
  await expect(page.locator("main")).toContainText("다른 기기와 후원자에게는 이 사진이 보이지 않습니다");
});
