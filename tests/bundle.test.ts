// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 한 거래로 묶기: 영수증에 거래명세서 같은 자료를 붙여도 지출은 한 건이고,
 * 붙인 사진이 저장, 동기화, 후원자용 보기, 내려받는 결산보고서까지 빠지지 않고 간다.
 */
import { describe, expect, it } from "vitest";
import { evidenceLabel } from "@/lib/csv";
import { recordDigest } from "@/lib/ledger";
import { memoryBag } from "@/lib/originals";
import { photoKey, photosOf, slotsOf } from "@/lib/photos";
import { buildReport, reportPhotos, reportToHtml } from "@/lib/report";
import { demoSnackExpense, seedExpenses } from "@/lib/seed";
import type { ViewBundle } from "@/lib/sponsor-view";
import { approveExpense, attachEvidence, confirmExpense, detachEvidence, evidenceMissing, newExpense } from "@/lib/status";
import { hydrateImages, LOCAL_IMAGE, loadExpenses, saveExpenses } from "@/lib/storage";
import { syncNow, type SyncApi, type SyncLocal } from "@/lib/sync-client";
import { decryptText, newWorkspace, viewerWorkspace } from "@/lib/sync-crypto";
import { IMAGE_REF, stripImages } from "@/lib/sync-merge";
import { getDoc, getImage, getView, MemoryStore, putDoc, putImage, putView, type SyncStore } from "@/lib/sync-store";
import type { Expense } from "@/lib/types";

const RECEIPT = "data:image/jpeg;base64," + "R".repeat(600);
const STATEMENT = "data:image/jpeg;base64," + "S".repeat(700);
const ORDER = "data:image/jpeg;base64," + "T".repeat(800);
const PROJECT = "자원봉사자 워크숍";
const shared = { org: "다온 나눔모임", projects: [PROJECT], funder: "", approver: "박대표", sponsorView: true, sponsorNames: false };

/** 영수증 한 장에 거래명세서와 주문내역을 붙인 지출 한 건. */
function grouped(): Expense {
  let e: Expense = { ...demoSnackExpense(), evidence: { kind: "receipt", image: RECEIPT, original: true }, updatedAt: "2026-11-20T10:00:00.000Z" };
  e = attachEvidence(e, { id: "st1", label: "거래명세서", image: STATEMENT, original: true }, "김총무");
  return attachEvidence(e, { id: "or1", label: "주문내역", image: ORDER }, "김총무");
}
function api(store: SyncStore): SyncApi {
  const out = async (r: Response) => ({ status: r.status, body: await r.json() });
  return {
    getDoc: async (id) => out(await getDoc(store, id)),
    putDoc: async (id, token, body) => out(await putDoc(store, id, token, body)),
    getImage: async (id, eid, kind) => out(await getImage(store, id, eid, kind)),
    putImage: async (id, eid, token, body, kind) => out(await putImage(store, id, eid, token, body, kind)),
    getView: async (id) => out(await getView(store, id)),
    putView: async (id, token, body) => out(await putView(store, id, token, body)),
  };
}
const device = (expenses: Expense[] = [], over: Partial<SyncLocal> = {}): SyncLocal => ({ expenses, tombstones: {}, shared, sharedAt: "2026-11-01T00:00:00.000Z", uploaded: [], ...over });
const memoryKv = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe("한 거래로 묶기", () => {
  it("자료를 붙여도 지출은 한 건이고 금액이 늘지 않는다", () => {
    const e = grouped();
    const r = buildReport([e, ...seedExpenses()], PROJECT);
    const alone = buildReport([demoSnackExpense(), ...seedExpenses()], PROJECT);
    expect(r.count).toBe(alone.count);
    expect(r.total).toBe(alone.total);
    expect(evidenceLabel(e)).toBe("영수증 첨부 + 거래명세서, 주문내역");
    expect(r.rows.find((x) => x.item === e.item)!.evidence).toBe("영수증 첨부 + 거래명세서, 주문내역");
    expect(photosOf(e).map((p) => [p.key, p.label])).toEqual([["demo-snack", "영수증"], ["demo-snack-x-st1", "거래명세서"], ["demo-snack-x-or1", "주문내역"]]);
  });

  it("종이 영수증이 없어도 거래명세서를 붙이면 증빙 보완에서 빠진다", () => {
    const online = newExpense({ id: "online", date: "2026-11-19", item: "현수막", amount: 33000, project: PROJECT, paymentMethod: "org_card" });
    expect(evidenceMissing(online)).toBe(true);
    const next = attachEvidence(online, { id: "a1", label: "거래명세서", image: STATEMENT }, "김총무");
    expect(evidenceMissing(next)).toBe(false);
    expect(evidenceLabel(next)).toBe("거래명세서 첨부");
    expect(evidenceMissing(detachEvidence(next, "a1", "김총무"))).toBe(true);
  });

  it("승인된 지출에 자료를 붙이거나 떼면 승인이 풀리고 이력이 남으며, 서명할 내용도 달라진다", async () => {
    const base: Expense = { ...demoSnackExpense(), evidence: { kind: "receipt", image: RECEIPT } };
    const approved = approveExpense(confirmExpense(base, "김총무"), "박대표");
    expect(approved.status).toBe("done");
    const next = attachEvidence(approved, { id: "st1", label: "거래명세서", image: STATEMENT }, "김총무");
    expect(next.approvedBy).toBeUndefined();
    expect(next.status).toBe("pending_approval");
    expect(next.log!.at(-1)!.text).toContain("거래명세서");
    expect(await recordDigest(next)).not.toBe(await recordDigest({ ...approved, approvedBy: undefined, approvedAt: undefined }));
    // 자료가 없는 기록의 서명 내용은 예전과 같다 (extra 칸이 생기지 않는다)
    expect(JSON.stringify(await recordDigest(base))).toBe(JSON.stringify(await recordDigest({ ...base, evidence: { ...base.evidence, extra: [] } })));
    const back = detachEvidence(approveExpense(next, "박대표"), "st1", "김총무");
    expect(back.approvedBy).toBeUndefined();
    expect(back.evidence.extra).toBeUndefined();
  });

  it("기기 저장: 사진 세 장을 모두 보관함에 두었다가 다시 채운다", async () => {
    const kv = memoryKv();
    const bag = memoryBag();
    saveExpenses(kv, [grouped()], bag);
    expect(kv.getItem("open-receipt:v1")).not.toContain("SSSSSSSS");
    expect([...bag.data.keys()].sort()).toEqual(["demo-snack", "demo-snack-x-or1", "demo-snack-x-st1"]);
    const loaded = loadExpenses(kv)!;
    expect(slotsOf(loaded[0]).map((s) => s.image)).toEqual([LOCAL_IMAGE, LOCAL_IMAGE, LOCAL_IMAGE]);
    const full = await hydrateImages(loaded, bag);
    expect(photosOf(full[0]).map((p) => p.image)).toEqual([RECEIPT, STATEMENT, ORDER]);
  });

  it("내려받는 결산보고서에 가린 사진이 지출별로 묶여 들어간다", () => {
    const list = [grouped(), ...seedExpenses()];
    const html = reportToHtml(buildReport(list, PROJECT), reportPhotos(list, PROJECT));
    expect(html).toContain("8. 증빙 사진");
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html.match(/<section class="ev">/g)).toHaveLength(1); // 한 지출 = 한 묶음
    for (const img of [RECEIPT, STATEMENT, ORDER]) expect(html).toContain(img);
    expect(html).toContain("<figcaption>거래명세서</figcaption>");
    // 사진이 없으면 그렇다고 적는다
    expect(reportToHtml(buildReport(seedExpenses(), PROJECT))).toContain("첨부된 증빙 사진이 없습니다.");
  });

  it("단체 공간: 다른 기기가 사진 세 장과 원본을 모두 받는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const bagA = memoryBag();
    await bagA.put("demo-snack", "data:image/jpeg;base64," + "O".repeat(900));
    await bagA.put(photoKey("demo-snack", "st1"), "data:image/jpeg;base64," + "P".repeat(900));
    await syncNow(ws, device([grouped()]), api(store), undefined, bagA);
    expect(slotsOf(stripImages([grouped()])[0]).map((s) => s.image)).toEqual([IMAGE_REF, IMAGE_REF, IMAGE_REF]);

    const bagB = memoryBag();
    const b = await syncNow(ws, device([]), api(store), undefined, bagB);
    expect(b.missingImages).toBe(0);
    expect(photosOf(b.expenses[0]).map((p) => p.image)).toEqual([RECEIPT, STATEMENT, ORDER]);
    expect(await bagB.get(photoKey("demo-snack", "st1"))).toContain("PPPP");
    expect(await bagB.get(photoKey("demo-snack", "or1"))).toBeNull(); // 원본이 없던 자료
  });

  it("후원자용 보기: 한 지출에 사진 세 장이 달리고, 후원자 열쇠로 모두 열린다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    await syncNow(ws, device([grouped(), ...seedExpenses()]), api(store), "2026-11-21T00:00:00.000Z");
    const viewer = await viewerWorkspace(ws);
    const bundle = JSON.parse((await decryptText(viewer, (await (await getView(store, ws.id)).json()).data))!) as ViewBundle;
    const p = bundle.projects.find((x) => x.project === PROJECT)!;
    const row = p.receipts.find((r) => r.id === "demo-snack")!;
    expect(p.report.count).toBe(seedExpenses().length + 1);
    expect(row.photos).toEqual([{ key: "demo-snack", label: "영수증" }, { key: "demo-snack-x-st1", label: "거래명세서" }, { key: "demo-snack-x-or1", label: "주문내역" }]);
    const want = [RECEIPT, STATEMENT, ORDER];
    for (const [i, ph] of row.photos!.entries()) {
      const res = await getImage(store, ws.id, ph.key, "view");
      expect(await decryptText(viewer, (await res.json()).data)).toBe(want[i]);
    }
  });

  it("후원자용 사진 올리기가 한 번 실패해도 다음 동기화에서 다시 올린다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    let fail = true;
    const flaky: SyncApi = { ...api(store), putImage: async (id, eid, token, body, kind) => (kind === "view" && fail ? { status: 500, body: {} } : api(store).putImage(id, eid, token, body, kind)) };
    const first = await syncNow(ws, device([grouped()]), flaky, "2026-11-21T00:00:00.000Z");
    expect((await getImage(store, ws.id, "demo-snack", "view")).status).toBe(404);
    // 기록은 그대로인데 사진만 빠져 있는 상태. 다시 동기화하면 채워진다.
    fail = false;
    await syncNow(ws, first, flaky, "2026-11-21T00:01:00.000Z");
    for (const key of ["demo-snack", "demo-snack-x-st1", "demo-snack-x-or1"]) expect((await getImage(store, ws.id, key, "view")).status).toBe(200);
  });

  it("사진을 아직 받지 못한 기기가 동기화해도 후원자용 보기에서 사진 표시가 사라지지 않는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    await syncNow(ws, device([grouped()]), api(store), "2026-11-21T00:00:00.000Z");
    // 승인자 기기: 사진 받기에 실패한 채로 동기화한다
    const noImages: SyncApi = { ...api(store), getImage: async () => ({ status: 500, body: {} }) };
    const b = await syncNow(ws, device([]), noImages, "2026-11-21T00:05:00.000Z");
    expect(b.missingImages).toBe(3);
    const viewer = await viewerWorkspace(ws);
    const bundle = JSON.parse((await decryptText(viewer, (await (await getView(store, ws.id)).json()).data))!) as ViewBundle;
    expect(bundle.projects[0].receipts[0].photos).toHaveLength(3);
  });
});
