// SPDX-License-Identifier: GPL-3.0-or-later
/** 사업 마감: 누가 마감할 수 있는지, 마감된 사업의 기록이 잠기는지, 두 기기의 마감이 어떻게 합쳐지는지. */
import { describe, expect, it } from "vitest";
import { changedAfterClose, closedBy, closeBlock, closeProject, closingOf, guardClosed, isClosed, mergeClosings, normalizeClosings, reopenProject, unfinished } from "@/lib/closing";
import { memoryBag } from "@/lib/originals";
import { buildReport, closedLine, reportToHtml } from "@/lib/report";
import { buildShare } from "@/lib/share";
import { buildViewBundle } from "@/lib/sponsor-view";
import { seedExpenses } from "@/lib/seed";
import { normalizeSettings } from "@/lib/settings";
import { syncNow, type SyncApi, type SyncLocal } from "@/lib/sync-client";
import { newWorkspace } from "@/lib/sync-crypto";
import { clearViewImages, delImage, getDoc, getImage, getView, MemoryStore, purgeRecordImages, putDoc, putImage, putView, type SyncStore } from "@/lib/sync-store";
import type { Expense } from "@/lib/types";

const P = "자원봉사자 워크숍";
const list = (): Expense[] => seedExpenses().map((e) => ({ ...e, project: P, updatedAt: "2026-11-20T00:00:00.000Z" }));
const closed = closeProject({}, P, "박대표", "2026-11-25T09:00:00.000Z");

describe("사업 마감", () => {
  it("마감하면 닫히고, 풀면 열린다. 누가 언제 했는지 남는다", () => {
    expect(isClosed({}, P)).toBe(false);
    expect(closingOf(closed, P)).toEqual({ at: "2026-11-25T09:00:00.000Z", by: "박대표" });
    const reopened = reopenProject(closed, P, "박대표", "2026-11-26T09:00:00.000Z");
    expect(isClosed(reopened, P)).toBe(false);
    expect(reopened[P]).toEqual({ at: "2026-11-26T09:00:00.000Z", by: "박대표", open: true });
    expect(isClosed(closed, "다른 사업")).toBe(false);
    expect(isClosed(closed, "")).toBe(false);
  });

  it("승인할 수 있는 사람만 마감한다", () => {
    expect(closeBlock({ name: "김", role: "submitter", shared: false })).toBeNull(); // 혼자 쓰는 기기
    expect(closeBlock({ name: "박", role: "approver", shared: true })).toBeNull();
    expect(closeBlock({ name: "김", role: "submitter", shared: true })).toBe("마감은 승인자가 합니다");
    expect(closeBlock({ name: "김", role: "submitter", shared: true }, { submitterApproves: true })).toBeNull();
  });

  it("마감된 사업의 기록은 고치기, 지우기, 새로 올리기, 옮기기가 모두 되돌려진다", () => {
    const prev = list();
    const other: Expense = { ...prev[0], id: "other", project: "봄 캠프" };
    const all = [...prev, other];
    // 고치기
    let g = guardClosed(all, all.map((e) => (e.id === prev[0].id ? { ...e, amount: 1 } : e)), closed);
    expect(g.blocked).toBe(1);
    expect(g.list.find((e) => e.id === prev[0].id)!.amount).toBe(prev[0].amount);
    expect(g.projects).toEqual([P]);
    // 지우기
    g = guardClosed(all, all.filter((e) => e.id !== prev[1].id), closed);
    expect(g.blocked).toBe(1);
    expect(g.list.some((e) => e.id === prev[1].id)).toBe(true);
    // 새로 올리기
    g = guardClosed(all, [...all, { ...prev[0], id: "new" }], closed);
    expect(g.blocked).toBe(1);
    expect(g.list.some((e) => e.id === "new")).toBe(false);
    // 다른 사업의 기록을 마감된 사업으로 옮기기, 마감된 사업의 기록을 빼기
    expect(guardClosed(all, all.map((e) => (e.id === "other" ? { ...e, project: P } : e)), closed).blocked).toBe(1);
    expect(guardClosed(all, all.map((e) => (e.id === prev[0].id ? { ...e, project: "봄 캠프" } : e)), closed).blocked).toBe(1);
    // 다른 사업은 그대로 된다
    g = guardClosed(all, all.map((e) => (e.id === "other" ? { ...e, amount: 7 } : e)), closed);
    expect(g.blocked).toBe(0);
    expect(g.list.find((e) => e.id === "other")!.amount).toBe(7);
    // 마감을 풀면 다시 된다
    expect(guardClosed(all, all.map((e) => (e.id === prev[0].id ? { ...e, amount: 1 } : e)), reopenProject(closed, P, "박대표")).blocked).toBe(0);
    // 사진 크기만 다시 맞춘 것은 변경으로 보지 않는다
    const photo = all.map((e) => (e.id === prev[0].id ? { ...e, evidence: { ...e.evidence, image: "data:image/jpeg;base64,AAAA" } } : e));
    expect(guardClosed(all.map((e) => (e.id === prev[0].id ? { ...e, evidence: { ...e.evidence, image: "data:image/jpeg;base64,BBBBBBBB" } } : e)), photo, closed).blocked).toBe(0);
  });

  it("마감 뒤에 바뀐 기록과 끝나지 않은 기록을 찾는다", () => {
    const items = list();
    const late = items.map((e, i) => (i === 0 ? { ...e, updatedAt: "2026-11-25T10:00:00.000Z" } : e));
    expect(changedAfterClose(late, closed, P).map((e) => e.id)).toEqual([items[0].id]);
    expect(changedAfterClose(late, {}, P)).toEqual([]);
    expect(unfinished(items, P)).toBe(items.filter((e) => e.status !== "done").length);
  });

  it("두 기기의 마감 기록은 사업마다 나중 것이 남는다", () => {
    const a = closeProject({}, P, "박대표", "2026-11-25T09:00:00.000Z");
    const b = reopenProject({}, P, "김총무", "2026-11-25T10:00:00.000Z");
    expect(isClosed(mergeClosings(a, b), P)).toBe(false); // 나중에 푼 것이 이긴다
    expect(isClosed(mergeClosings(b, a), P)).toBe(false);
    const c = closeProject({}, "봄 캠프", "박대표", "2026-11-24T09:00:00.000Z");
    expect(Object.keys(mergeClosings(a, c)).sort()).toEqual([P, "봄 캠프"].sort());
    expect(mergeClosings(undefined, undefined)).toEqual({});
  });

  it("깨진 값은 걸러 낸다", () => {
    expect(normalizeClosings({ [P]: { at: "2026-11-25T09:00:00.000Z", by: "박대표" }, 나쁨: { at: "어제" }, "": { at: "2026-11-25T09:00:00.000Z" }, 풀림: { at: "2026-11-25T09:00:00.000Z", by: "", open: true } })).toEqual({ [P]: { at: "2026-11-25T09:00:00.000Z", by: "박대표" }, 풀림: { at: "2026-11-25T09:00:00.000Z", by: "", open: true } });
    expect(normalizeClosings(null)).toEqual({});
    expect(normalizeSettings({}).closed).toEqual({});
  });
});

describe("보고서의 마감 표시", () => {
  it("결산보고서, 내려받는 파일, 공유 링크, 후원자용 보기에 마감 표시가 들어간다. 마감한 사람이 아니라 단체 이름으로 적는다", () => {
    const open = buildReport(list(), P, "2026-11-26T00:00:00.000Z");
    expect(open.closed).toBeUndefined();
    expect(reportToHtml(open)).toContain("결산보고서 초안");
    expect(closedBy({}, P, "다온 나눔모임")).toBeNull();
    const r = buildReport(list(), P, "2026-11-26T00:00:00.000Z", {}, closedBy(closed, P, "다온 나눔모임"));
    expect(r.closed).toEqual({ at: "2026-11-25T09:00:00.000Z", by: "다온 나눔모임" });
    const html = reportToHtml(r);
    expect(html).toContain("마감 2026-11-25 (다온 나눔모임)");
    expect(html).not.toContain("결산보고서 초안");
    expect(html).not.toContain("박대표"); // 마감 처리한 사람의 이름은 보고서에 싣지 않는다
    // 공유 링크: 이름을 가려도 단체 이름은 그대로 나간다 (사람 이름이 아니다)
    const shared = buildShare(r, "다온 나눔모임", { includeRows: true, showNames: false });
    expect(shared.report.closed).toEqual({ at: "2026-11-25T09:00:00.000Z", by: "다온 나눔모임" });
    expect(JSON.stringify(shared.report.closed)).not.toContain("박대표");
    // 단체 이름을 적지 않았으면 날짜만
    expect(closedLine(closedBy(closed, P, "")!)).toBe("마감 2026-11-25");
    // 후원자용 보기: 마감한 사업에만 표시가 붙는다
    const other = { ...list()[0], id: "x", project: "봄 캠프" };
    const bundle = buildViewBundle([...list(), other], "다온 나눔모임", { enabled: true, showNames: false, closed });
    expect(bundle.projects.find((p) => p.project === P)!.report.closed).toEqual({ at: "2026-11-25T09:00:00.000Z", by: "다온 나눔모임" });
    expect(bundle.projects.find((p) => p.project === "봄 캠프")!.report.closed).toBeUndefined();
    expect(JSON.stringify(bundle)).not.toContain("박대표");
    // 마감을 풀면 사라진다
    expect(buildViewBundle(list(), "다온", { enabled: true, showNames: true, closed: reopenProject(closed, P, "박대표") }).projects[0].report.closed).toBeUndefined();
  });
});

describe("마감이 단체 공간에서 전해진다", () => {
  function api(store: SyncStore): SyncApi {
    const out = async (r: Response) => ({ status: r.status, body: await r.json() });
    return {
      getDoc: async (id, since) => out(await getDoc(store, id, since)),
      putDoc: async (id, token, body) => out(await putDoc(store, id, token, body)),
      getImage: async (id, eid, kind) => out(await getImage(store, id, eid, kind)),
      putImage: async (id, eid, token, body, kind) => out(await putImage(store, id, eid, token, body, kind)),
      delImage: async (id, eid, token, kind) => out(await delImage(store, id, eid, token, kind)),
      purgeRecord: async (id, eid, token) => out(await purgeRecordImages(store, id, eid, token)),
      getView: async (id) => out(await getView(store, id)),
      clearView: async (id, token) => out(await clearViewImages(store, id, token)),
      putView: async (id, token, body) => out(await putView(store, id, token, body)),
    };
  }
  const shared = { org: "다온 나눔모임", projects: [P], funder: "", approver: "박대표" };
  const device = (over: Partial<SyncLocal> = {}): SyncLocal => ({ expenses: [], tombstones: {}, shared, sharedAt: "2026-11-01T00:00:00.000Z", uploaded: [], ...over });

  it("한 기기가 마감하면 다른 기기도 마감을 받고, 그 사이 다른 설정을 바꾼 기기가 있어도 마감이 사라지지 않는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const a1 = await syncNow(ws, device({ expenses: list() }), api(store), "2026-11-25T08:00:00.000Z", memoryBag());
    const b1 = await syncNow(ws, device(), api(store), "2026-11-25T08:01:00.000Z", memoryBag());
    // 대표(B)가 마감한다
    const b2 = await syncNow(ws, { ...b1, shared: { ...b1.shared, closed }, sharedAt: "2026-11-25T09:00:00.000Z" }, api(store), "2026-11-25T09:00:10.000Z", memoryBag());
    expect(isClosed(b2.shared.closed, P)).toBe(true);
    // 총무(A)는 마감을 모르는 채로 더 나중에 다른 설정(지원기관)을 바꿨다. A의 설정이 더 새것이지만 마감은 남아야 한다
    const a2 = await syncNow(ws, { ...a1, shared: { ...a1.shared, funder: "가상 재단" }, sharedAt: "2026-11-25T09:30:00.000Z" }, api(store), "2026-11-25T09:30:10.000Z", memoryBag());
    expect(a2.shared.funder).toBe("가상 재단");
    expect(isClosed(a2.shared.closed, P)).toBe(true);
    expect(a2.changed).toBe(true);
    // B도 다시 맞추면 둘 다 가진다
    const b3 = await syncNow(ws, b2, api(store), "2026-11-25T09:31:00.000Z", memoryBag());
    expect(b3.shared.funder).toBe("가상 재단");
    expect(isClosed(b3.shared.closed, P)).toBe(true);
  });
});
