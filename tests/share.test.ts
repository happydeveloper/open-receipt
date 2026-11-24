// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 보고서 공유 링크(가림 선택, 압축과 복원)와 단체 설정·백업.
 */
import { describe, expect, it } from "vitest";
import { buildReport } from "@/lib/report";
import { demoSnackExpense, seedExpenses, DEMO_PROJECT } from "@/lib/seed";
import { buildShare, decodeShare, encodeShare, MASKED } from "@/lib/share";
import { addProject, DEMO_SETTINGS, EMPTY_SETTINGS, loadSettings, makeBackup, missingForStart, normalizeSettings, parseBackup, saveSettings } from "@/lib/settings";
import type { KV } from "@/lib/storage";

const report = () => buildReport([...seedExpenses(), demoSnackExpense()], DEMO_PROJECT, "2026-11-24T00:00:00.000Z");
function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("보고서 공유 링크", () => {
  it("기본값: 내역은 포함하되 사람 이름과 요약 문장은 가린다", () => {
    const s = buildShare(report(), "다온 나눔모임", { includeRows: true, showNames: false }, "2026-11-24T01:00:00.000Z");
    expect(s.report.total).toBe(56900);
    expect(s.report.rows).toHaveLength(3);
    expect(s.report.rows.every((r) => r.summary === "")).toBe(true);
    expect(s.report.reimbursements).toEqual([{ payer: MASKED, item: "행사 다과", amount: 26400, approved: false }]);
    expect(JSON.stringify(s)).not.toContain("김○○");
  });
  it("요약만: 건별 내역, 환급 대상, 확인할 항목을 빼고 합계와 분류만 남긴다", () => {
    const s = buildShare(report(), "다온 나눔모임", { includeRows: false, showNames: false });
    expect(s.report.rows).toEqual([]);
    expect(s.report.reimbursements).toEqual([]);
    expect(s.report.openItems).toEqual([]);
    expect(s.report.byCategory.reduce((a, g) => a + g.amount, 0)).toBe(56900);
    expect(s.report.reimbursementTotal).toBe(26400);
  });
  it("이름 표시를 켜면 그대로 담는다", () => {
    const s = buildShare(report(), "다온 나눔모임", { includeRows: true, showNames: true });
    expect(s.report.reimbursements[0].payer).toBe("김○○");
    expect(s.report.rows.some((r) => r.summary.includes("김○○"))).toBe(true);
  });
  it("링크에 담았다가 그대로 되살린다 (한글 포함)", async () => {
    const s = buildShare(report(), "다온 나눔모임", { includeRows: true, showNames: true }, "2026-11-24T01:00:00.000Z");
    const code = await encodeShare(s);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(3000);
    expect(await decodeShare(code)).toEqual(s);
    expect(await decodeShare("#" + code)).toEqual(s);
  });
  it("깨졌거나 다른 형식의 링크는 null", async () => {
    expect(await decodeShare("")).toBeNull();
    expect(await decodeShare("not-a-report")).toBeNull();
    const other = await encodeShare({ v: 2, hello: 1 } as any);
    expect(await decodeShare(other)).toBeNull();
  });
});

describe("단체 설정과 백업", () => {
  it("저장하고 다시 읽는다. 값은 다듬어 저장한다", () => {
    const kv = memoryKV();
    expect(loadSettings(kv)).toEqual(EMPTY_SETTINGS);
    saveSettings(kv, { ...DEMO_SETTINGS, org: "  다온 나눔모임  ", projects: ["워크숍", "워크숍", "", "캠프"] });
    expect(loadSettings(kv)).toMatchObject({ org: "다온 나눔모임", projects: ["워크숍", "캠프"], onboarded: true });
    expect(normalizeSettings("깨진 값")).toEqual(EMPTY_SETTINGS);
  });
  it("시작에 필요한 값이 빠졌는지 알려 준다", () => {
    expect(missingForStart(EMPTY_SETTINGS)).toEqual(["단체 이름", "내 이름", "첫 사업·행사 이름"]);
    expect(missingForStart({ ...EMPTY_SETTINGS, org: "모임", submitter: "나", projects: ["행사"] })).toEqual([]);
  });
  it("사업을 추가한다 (중복·빈 이름 무시)", () => {
    const s = addProject(DEMO_SETTINGS, " 겨울 캠프 ");
    expect(s.projects).toEqual(["자원봉사자 워크숍", "겨울 캠프"]);
    expect(addProject(s, "겨울 캠프")).toBe(s);
    expect(addProject(s, "  ")).toBe(s);
  });
  it("백업을 내보내고 가져온다. 형식이 다르면 거부한다", () => {
    const list = [...seedExpenses(), demoSnackExpense()];
    const text = makeBackup(DEMO_SETTINGS, list, "2026-11-24T00:00:00.000Z");
    const back = parseBackup(text)!;
    expect(back.expenses).toEqual(JSON.parse(JSON.stringify(list)));
    expect(back.settings).toEqual(DEMO_SETTINGS);
    expect(parseBackup("{}")).toBeNull();
    expect(parseBackup("깨진 파일")).toBeNull();
    expect(parseBackup(JSON.stringify({ kind: "open-receipt-backup", expenses: [{ nope: 1 }, list[0]] }))!.expenses).toHaveLength(1);
  });
});
