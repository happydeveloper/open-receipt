// SPDX-License-Identifier: GPL-3.0-or-later
/** 오류 보고에 열쇠, 사진, 번호, 화면에 적은 글이 딸려 나가지 않는지. */
import { describe, expect, it } from "vitest";
import { scrubCrumb, scrubEvent, scrubText, scrubUrl } from "@/lib/scrub";
import { inviteCode, newWorkspace } from "@/lib/sync-crypto";

describe("오류 보고에서 민감한 것 지우기", () => {
  const ws = newWorkspace();
  const invite = `https://open-receipt.example/app#${inviteCode(ws)}`;

  it("주소의 # 뒤와 ? 뒤, 긴 값, 사진, 번호, 메일을 지운다", () => {
    expect(scrubText(`초대 ${invite} 열다 실패`)).not.toContain(ws.key);
    expect(scrubText(`초대 ${invite} 열다 실패`)).not.toContain(ws.id);
    expect(scrubText("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv")).toBe("[사진]");
    expect(scrubText("카드 1234-5678-9012-3456 결제")).toBe("카드 [숫자] 결제");
    expect(scrubText("문의 kim@example.org 로")).toBe("문의 [메일] 로");
    expect(scrubText("/v?x=abc 실패")).toBe("/v?[가림] 실패");
    expect(scrubText("가".repeat(5000)).length).toBe(2000);
    expect(scrubText(undefined)).toBe("");
  });

  it("주소는 경로만 남긴다", () => {
    expect(scrubUrl(invite)).toBe("https://open-receipt.example/app");
    expect(scrubUrl(`/api/sync/${ws.id}?since=3`)).toBe("/api/sync/[값]");
    expect(scrubUrl("")).toBe("");
  });

  it("사건에서 사용자 정보·헤더·변수 값을 버리고 남는 글을 모두 지운다", () => {
    const event = scrubEvent({
      user: { ip_address: "1.2.3.4", email: "kim@example.org" },
      request: { url: invite, method: "GET", headers: { cookie: "a=b" }, cookies: { a: "b" }, data: "본문" },
      message: `열지 못함 ${invite}`,
      exception: { values: [{ type: "Error", value: `열쇠 ${ws.key} 가 맞지 않음`, stacktrace: { frames: [{ filename: "app.js", abs_path: invite, vars: { expense: "현수막 9,000원" } }] } }] },
      breadcrumbs: [
        { category: "console", message: "기록: 현수막 끈 9,000원" },
        { category: "navigation", data: { from: "/app", to: invite } },
        { category: "fetch", data: { url: `https://open-receipt.example/api/sync/${ws.id}`, status_code: 500 } },
      ],
      extra: { note: `링크 ${invite}` },
      contexts: { browser: { name: "Chrome" }, state: { expenses: ["현수막"] } },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(ws.key);
    expect(text).not.toContain(ws.id);
    expect(text).not.toContain("kim@example.org");
    expect(text).not.toContain("cookie");
    expect(text).not.toContain("현수막");
    expect(event.request).toEqual({ url: "https://open-receipt.example/app", method: "GET" });
    expect(event.breadcrumbs).toHaveLength(2);
    expect((event.breadcrumbs[1] as any).data.status_code).toBe(500);
    expect(event.contexts).toEqual({ browser: { name: "Chrome" } });
  });

  it("콘솔 기록은 남기지 않는다", () => {
    expect(scrubCrumb({ category: "console", message: "무엇이든" })).toBeNull();
    expect(scrubCrumb({ category: "ui.click", message: 'button[aria-label="현수막 끈 9,000원"]' })).toEqual({ category: "ui.click", message: "" });
  });
});

import { isStaleChunk } from "@/app/error-screen";
describe("새 버전 배포 뒤의 조각 오류", () => {
  it("화면 조각을 받아 오지 못한 오류만 골라낸다 (이때는 알아서 한 번 새로 고친다)", () => {
    expect(isStaleChunk({ name: "ChunkLoadError", message: "Loading chunk app/app/page failed." })).toBe(true);
    expect(isStaleChunk({ name: "TypeError", message: "Failed to fetch dynamically imported module: https://x/_next/a.js" })).toBe(true);
    expect(isStaleChunk({ name: "Error", message: "열린영수증 오류 화면 시험 (일부러 낸 오류)" })).toBe(false);
    expect(isStaleChunk({ name: "TypeError", message: "Cannot read properties of undefined" })).toBe(false);
  });
});
