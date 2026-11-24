// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 출시 알림 대기자 등록과 취소.
 */
import { describe, expect, it } from "vitest";
import { MemoryStore } from "@/lib/sync-store";
import { joinWaitlist, leaveWaitlist, listWaitlist } from "@/lib/waitlist";

describe("출시 알림 대기자 등록", () => {
  it("동의한 이메일을 저장한다. 같은 이메일은 한 번만", async () => {
    const store = new MemoryStore();
    const ok = await joinWaitlist(store, { email: " Daon@Example.org ", org: "다온 나눔모임", use: "행사 정산", consent: true }, "2026-11-23T00:00:00.000Z");
    expect(ok.status).toBe(200);
    const again = await joinWaitlist(store, { email: "daon@example.org", consent: true }, "2026-11-24T00:00:00.000Z");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
    expect(await listWaitlist(store)).toEqual([{ email: "daon@example.org", org: "다온 나눔모임", use: "행사 정산", consentedAt: "2026-11-23T00:00:00.000Z" }]);
    // 저장 이름에 이메일이 드러나지 않는다
    expect([...store.data.keys()].join()).not.toContain("daon");
  });
  it("동의가 없거나 이메일이 이상하면 받지 않는다", async () => {
    const store = new MemoryStore();
    expect((await joinWaitlist(store, { email: "daon@example.org" })).status).toBe(400);
    expect((await joinWaitlist(store, { email: "daon@example.org", consent: "yes" })).status).toBe(400);
    for (const email of ["", "daon", "daon@", "@example.org", "a b@example.org", "daon@example"]) expect((await joinWaitlist(store, { email, consent: true })).status).toBe(400);
    expect((await joinWaitlist(store, null)).status).toBe(400);
    expect(store.data.size).toBe(0);
  });
  it("자동 프로그램이 숨은 칸을 채우면 저장하지 않고 넘긴다. 저장소가 없으면 503", async () => {
    const store = new MemoryStore();
    expect((await joinWaitlist(store, { email: "bot@example.org", consent: true, website: "http://spam" })).status).toBe(200);
    expect(store.data.size).toBe(0);
    expect((await joinWaitlist(null, { email: "a@example.org", consent: true })).status).toBe(503);
  });
  it("등록을 취소하면 이메일을 지운다", async () => {
    const store = new MemoryStore();
    await joinWaitlist(store, { email: "daon@example.org", consent: true });
    await joinWaitlist(store, { email: "other@example.org", consent: true });
    expect((await leaveWaitlist(store, { email: "DAON@example.org" })).status).toBe(200);
    expect((await listWaitlist(store)).map((e) => e.email)).toEqual(["other@example.org"]);
    expect((await leaveWaitlist(store, { email: "never@example.org" })).status).toBe(200); // 등록 여부를 알려 주지 않는다
    expect((await leaveWaitlist(store, { email: "이상함" })).status).toBe(400);
  });
});
