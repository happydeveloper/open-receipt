// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 공간(한 기기의 여러 장부)과 거래처별 공유.
 */
import { describe, expect, it } from "vitest";
import { memoryBag } from "@/lib/originals";
import { buildReport, buildVendorReport, vendorsOf } from "@/lib/report";
import { demoSnackExpense, seedExpenses, DEMO_PROJECT } from "@/lib/seed";
import { DEMO_SETTINGS, EMPTY_SETTINGS, loadSettings, saveSettings, SETTINGS_KEY } from "@/lib/settings";
import { buildShare, decodeShare, encodeShare } from "@/lib/share";
import { addSpace, describeSpace, dropSpace, loadSpaces, newSlot, normalizeSpaces, openSpace, saveSpaces, scopedBag, scopedKV, SPACE_MAX, SPACES_KEY, spaceOfWorkspace, wipeSpace } from "@/lib/spaces";
import { loadExpenses, saveExpenses, STORAGE_KEY, type KV } from "@/lib/storage";
import { EMPTY_META, loadMeta, saveMeta, SYNC_KEY } from "@/lib/sync-client";

function memoryKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const WS = { id: "a".repeat(22), key: "k".repeat(43) };

describe("공간 목록", () => {
  it("처음에는 예전 이름 그대로 쓰는 첫 공간 하나가 있다", () => {
    expect(loadSpaces(memoryKV())).toEqual({ active: "", list: [{ slot: "", createdAt: "" }] });
    expect(normalizeSpaces({ active: "없는자리", list: "깨짐" }).active).toBe("");
  });
  it("공간을 더하면 그 공간이 열리고, 저장했다 읽어도 같다", () => {
    const kv = memoryKV();
    const next = addSpace(loadSpaces(kv), "abc12345", "2026-11-28T00:00:00.000Z");
    expect(next.active).toBe("abc12345");
    expect(saveSpaces(kv, next)).toBe(true);
    expect(loadSpaces(kv)).toEqual(next);
    expect(openSpace(next, "").active).toBe("");
    expect(openSpace(next, "모르는자리")).toBe(next);
  });
  it("정한 개수까지만 만들 수 있다", () => {
    let s = loadSpaces(memoryKV());
    for (let i = 0; i < SPACE_MAX + 3; i++) s = addSpace(s, `slot${i}`);
    expect(s.list).toHaveLength(SPACE_MAX);
  });
  it("하나 남은 공간은 뺄 수 없고, 열린 공간을 빼면 남은 첫 공간이 열린다", () => {
    const one = loadSpaces(memoryKV());
    expect(dropSpace(one, "")).toBe(one);
    const two = addSpace(one, "abc12345");
    expect(dropSpace(two, "abc12345")).toEqual({ active: "", list: one.list });
    expect(dropSpace(two, "").active).toBe("abc12345");
  });
  it("자리 이름은 소문자와 숫자 8자다", () => {
    expect(newSlot()).toMatch(/^[a-z0-9]{8}$/);
    expect(newSlot()).not.toBe(newSlot());
  });
});

describe("공간마다 따로 저장한다", () => {
  it("한 공간의 기록과 설정은 다른 공간에서 보이지 않는다", () => {
    const kv = memoryKV();
    const first = scopedKV(kv, ""), second = scopedKV(kv, "abc12345");
    saveSettings(first, DEMO_SETTINGS);
    saveExpenses(first, seedExpenses());
    saveSettings(second, { ...EMPTY_SETTINGS, org: "새벽 공부방" });
    expect(loadSettings(first).org).toBe(DEMO_SETTINGS.org);
    expect(loadSettings(second).org).toBe("새벽 공부방");
    expect(loadExpenses(second)).toBeNull();
    // 첫 공간은 예전 이름 그대로라 옮길 것이 없다
    expect(kv.data.has(SETTINGS_KEY)).toBe(true);
    expect(kv.data.has(`${SETTINGS_KEY}@abc12345`)).toBe(true);
  });
  it("공간 목록은 어느 공간에서 읽어도 같다", () => {
    const kv = memoryKV();
    saveSpaces(scopedKV(kv, "abc12345"), addSpace(loadSpaces(kv), "abc12345"));
    expect(kv.data.has(SPACES_KEY)).toBe(true);
    expect(loadSpaces(scopedKV(kv, "")).active).toBe("abc12345");
  });
  it("사진도 공간마다 따로 둔다", async () => {
    const bag = memoryBag();
    const slot = { now: "" };
    const mine = scopedBag(bag, () => slot.now);
    await mine.put("seed-1", "첫 공간 사진");
    slot.now = "abc12345";
    expect(await mine.get("seed-1")).toBeNull();
    await mine.put("seed-1", "둘째 공간 사진");
    expect([...bag.data.keys()].sort()).toEqual(["abc12345/seed-1", "seed-1"]);
  });
  it("목록에 보일 한 줄: 단체 이름, 건수, 연결 여부, 초대 링크", () => {
    const kv = memoryKV();
    const second = scopedKV(kv, "abc12345");
    saveSettings(second, { ...EMPTY_SETTINGS, org: "새벽 공부방" });
    saveExpenses(second, seedExpenses());
    saveMeta(second, { ...EMPTY_META, ws: WS });
    expect(describeSpace(kv, "abc12345")).toEqual({ slot: "abc12345", org: "새벽 공부방", count: seedExpenses().length, connected: true, locked: false, invite: `join=${WS.id}.${WS.key}`, workspaceId: WS.id });
    expect(describeSpace(kv, "")).toMatchObject({ org: "", count: 0, connected: false, invite: "" });
    const all = addSpace(loadSpaces(kv), "abc12345");
    expect(spaceOfWorkspace(kv, all, WS.id)).toBe("abc12345");
    expect(spaceOfWorkspace(kv, all, "b".repeat(22))).toBeNull();
  });
  it("공간을 지우면 그 공간의 기록, 설정, 연결, 사진만 사라진다", async () => {
    const kv = memoryKV();
    const bag = memoryBag();
    const first = scopedKV(kv, ""), second = scopedKV(kv, "abc12345");
    saveSettings(first, DEMO_SETTINGS);
    saveExpenses(first, seedExpenses());
    await bag.put("seed-1", "첫 공간 사진");
    saveSettings(second, { ...EMPTY_SETTINGS, org: "새벽 공부방" });
    saveExpenses(second, seedExpenses());
    saveMeta(second, { ...EMPTY_META, ws: WS });
    const id = seedExpenses()[0].id;
    await bag.put(`abc12345/${id}`, "둘째 공간 사진");
    await wipeSpace(kv, "abc12345", [bag]);
    expect([...kv.data.keys()].filter((k) => k.endsWith("@abc12345"))).toEqual([]);
    expect(bag.data.has(`abc12345/${id}`)).toBe(false);
    expect(bag.data.get("seed-1")).toBe("첫 공간 사진");
    expect(loadSettings(first).org).toBe(DEMO_SETTINGS.org);
    expect(loadExpenses(first)).toHaveLength(seedExpenses().length);
    expect(loadMeta(second).ws).toBeNull();
    expect(kv.data.has(STORAGE_KEY)).toBe(true);
    expect(kv.data.has(SYNC_KEY)).toBe(false);
  });
});

describe("거래처별 공유", () => {
  const all = () => [...seedExpenses(), demoSnackExpense(), { ...demoSnackExpense(), id: "other", project: "겨울 캠프", amount: 10000, payer: "이회원" }];
  it("거래처마다 건수와 금액을 모은다. 거래처를 적지 않은 기록은 뺀다", () => {
    const v = vendorsOf(all());
    expect(v.find((x) => x.name === "○○마트")).toEqual({ name: "○○마트", count: 2, amount: 36400 });
    expect(v.some((x) => x.name === "" || x.name === "미분류")).toBe(false);
  });
  it("거래처 내역에는 그 거래처의 지출만, 모든 사업에서 모아 담는다", () => {
    const r = buildVendorReport(all(), "○○마트", "2026-11-28T00:00:00.000Z");
    expect(r.scope).toBe("vendor");
    expect(r.project).toBe("○○마트");
    expect(r.count).toBe(2);
    expect(r.total).toBe(36400);
    expect(r.byCategory.map((g) => g.name).sort()).toEqual([DEMO_PROJECT, "겨울 캠프"].sort());
    expect(r.rows.map((x) => x.budgetCategory).sort()).toEqual([DEMO_PROJECT, "겨울 캠프"].sort());
  });
  it("단체 안에서만 볼 것은 싣지 않는다: 확인할 항목, 환급 대상, 요약 문장, 사람 이름", async () => {
    const r = buildVendorReport(all(), "○○마트");
    expect(r.openItems).toEqual([]);
    expect(r.reimbursements).toEqual([]);
    expect(r.reimbursementTotal).toBe(0);
    expect(r.rows.every((x) => x.summary === "")).toBe(true);
    const text = JSON.stringify(buildShare(r, "다온 나눔모임", { includeRows: true, showNames: false }));
    expect(text).not.toContain("이회원");
    expect(text).not.toContain("김○○");
    // 다른 거래처의 지출은 링크에 들어가지 않는다
    expect(text).not.toContain("○○인쇄");
    const back = await decodeShare(await encodeShare(buildShare(r, "다온 나눔모임", { includeRows: true, showNames: false })));
    expect(back?.report.scope).toBe("vendor");
    expect(back?.report.total).toBe(36400);
  });
  it("사업별 보고서는 그대로다", () => {
    const r = buildReport(all(), DEMO_PROJECT, "2026-11-24T00:00:00.000Z");
    expect(r.scope).toBeUndefined();
    expect(r.total).toBe(56900);
  });
});
