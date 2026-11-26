// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 단체 공간: 암호화, 기록 합치기, 메모리 저장소를 사이에 둔 두 기기 동기화,
 * 원본 영수증 공유, 후원자 열쇠의 권한 범위.
 */
import { describe, expect, it } from "vitest";
import { decryptText, encryptText, packText, unpackText, inviteCode, newWorkspace, parseInvite, parseViewCode, viewCode, viewerWorkspace, writeToken } from "@/lib/sync-crypto";
import { memoryBag } from "@/lib/originals";
import type { ViewBundle } from "@/lib/sponsor-view";
import { IMAGE_REF, mergeExpenses, slimGuidance, stripImages, touchChanged } from "@/lib/sync-merge";
import { syncNow, SyncError, type SyncApi, type SyncLocal } from "@/lib/sync-client";
import { clearViewImages, delImage, getDoc, getImage, getView, MemoryStore, purgeRecordImages, putDoc, putImage, putView, type SyncStore } from "@/lib/sync-store";
import { demoSnackExpense, seedExpenses } from "@/lib/seed";
import { approveExpense } from "@/lib/status";
import type { Expense } from "@/lib/types";

const at = (e: Expense, t: string): Expense => ({ ...e, updatedAt: t });
const shared = { org: "다온 나눔모임", projects: ["자원봉사자 워크숍"], funder: "", approver: "박대표" };
const BIG = "data:image/jpeg;base64," + "A".repeat(600);

/** 서버 핸들러를 직접 부르는 API (네트워크 없이 실제 서버 로직을 탄다). */
function api(store: SyncStore | null): SyncApi {
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
const device = (expenses: Expense[] = [], over: Partial<SyncLocal> = {}): SyncLocal => ({ expenses, tombstones: {}, shared, sharedAt: "2026-11-01T00:00:00.000Z", uploaded: [], ...over });

describe("단체 공간 암호화", () => {
  it("암호화한 내용은 같은 열쇠로만 열린다", async () => {
    const ws = newWorkspace();
    const secret = "김○○ 개인 카드 26,400원";
    const enc = await encryptText(ws, secret);
    expect(enc).not.toContain("26,400");
    expect(await decryptText(ws, enc)).toBe(secret);
    expect(await decryptText({ ...ws, key: newWorkspace().key }, enc)).toBeNull();
    expect(await decryptText(ws, enc.slice(0, -4) + "AAAA")).toBeNull();
    expect(await encryptText(ws, secret)).not.toBe(enc); // 매번 다른 암호문
  });
  it("초대 링크에 주소와 열쇠를 담고 되읽는다", () => {
    const ws = newWorkspace();
    expect(parseInvite("#" + inviteCode(ws))).toEqual(ws);
    expect(parseInvite("#join=short.key")).toBeNull();
    expect(parseInvite("#other")).toBeNull();
  });
});

describe("기록 합치기", () => {
  const [print, transport] = seedExpenses();
  it("같은 기록은 더 최근에 바뀐 쪽을 고른다", () => {
    const mine = at({ ...transport, amount: 13000 }, "2026-11-20T10:00:00.000Z");
    const theirs = at(transport, "2026-11-20T09:00:00.000Z");
    expect(mergeExpenses([mine], [theirs], {}, {}).expenses[0].amount).toBe(13000);
    expect(mergeExpenses([theirs], [mine], {}, {}).expenses[0].amount).toBe(13000);
  });
  it("양쪽에만 있는 기록은 모두 남긴다", () => {
    const out = mergeExpenses([at(print, "2026-11-20T00:00:00.000Z")], [at(transport, "2026-11-20T00:00:00.000Z")], {}, {});
    expect(out.expenses.map((e) => e.id).sort()).toEqual(["seed-print", "seed-transport"]);
  });
  it("삭제는 그 뒤에 바뀌지 않았을 때만 적용하고, 다시 고친 기록은 살린다", () => {
    const old = at(print, "2026-11-20T00:00:00.000Z");
    const gone = mergeExpenses([], [old], { "seed-print": "2026-11-21T00:00:00.000Z" }, {});
    expect(gone.expenses).toEqual([]);
    expect(gone.tombstones["seed-print"]).toBeTruthy();
    const edited = at(print, "2026-11-22T00:00:00.000Z");
    const kept = mergeExpenses([], [edited], { "seed-print": "2026-11-21T00:00:00.000Z" }, {});
    expect(kept.expenses).toHaveLength(1);
    expect(kept.tombstones["seed-print"]).toBeUndefined();
  });
  it("바뀐 기록에만 시각을 찍는다", () => {
    const a = at(print, "2026-11-20T00:00:00.000Z");
    const b = at(transport, "2026-11-20T00:00:00.000Z");
    const out = touchChanged([a, b], [a, { ...b, amount: 1 }, demoSnackExpense()], "2026-11-23T00:00:00.000Z");
    expect(out.map((e) => e.updatedAt)).toEqual(["2026-11-20T00:00:00.000Z", "2026-11-23T00:00:00.000Z", "2026-11-23T00:00:00.000Z"]);
  });
});

describe("두 기기 동기화", () => {
  it("총무가 올린 기록을 승인자가 받아 승인하고, 총무가 그 승인을 받는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const snack = at({ ...demoSnackExpense(), evidence: { kind: "receipt", image: BIG } }, "2026-11-20T10:00:00.000Z");

    // 총무 기기: 단체 공간을 만들고 올린다
    const a1 = await syncNow(ws, device([snack]), api(store), "2026-11-20T10:01:00.000Z");
    expect(a1.version).toBe(1);
    expect(a1.changed).toBe(false);
    // 서버에는 암호문만 있다
    const stored = [...store.data.values()].join("\n");
    expect(stored).not.toContain("행사 다과");
    expect(stored).not.toContain("26400");
    expect(stored).not.toContain("AAAAAAAAAA");
    expect(stored).not.toContain(ws.key);

    // 승인자 기기: 빈 상태에서 참여 → 기록과 이미지를 받는다
    const b1 = await syncNow(ws, device([], { shared: { org: "", projects: [], funder: "", approver: "" }, sharedAt: "" }), api(store), "2026-11-20T11:00:00.000Z");
    expect(b1.changed).toBe(true);
    expect(b1.expenses).toHaveLength(1);
    expect(b1.expenses[0].evidence.image).toBe(BIG);
    expect(b1.missingImages).toBe(0);
    expect(b1.shared.org).toBe("다온 나눔모임");
    expect(b1.expenses[0].status).toBe("pending_approval");

    // 승인자가 승인하고 올린다
    const approved = at(approveExpense(b1.expenses[0], "박대표", "2026-11-20T11:05:00.000Z"), "2026-11-20T11:05:00.000Z");
    const b2 = await syncNow(ws, { ...b1, expenses: [approved] }, api(store), "2026-11-20T11:06:00.000Z");
    expect(b1.version).toBe(1); // 참여만 하고 바꾼 것이 없으면 문서를 다시 올리지 않는다
    expect(b2.version).toBe(2);

    // 총무 기기가 다시 동기화하면 승인이 반영된다. 이미지는 다시 올리지 않는다.
    const before = store.data.size;
    const a2 = await syncNow(ws, a1, api(store), "2026-11-20T12:00:00.000Z");
    expect(a2.changed).toBe(true);
    expect(a2.expenses[0]).toMatchObject({ status: "done", approvedBy: "박대표" });
    expect(a2.expenses[0].evidence.image).toBe(BIG);
    expect(store.data.size).toBe(before);
  });

  it("한쪽에서 지운 기록은 다른 기기에서도 사라진다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const [print, transport] = seedExpenses().map((e) => at(e, "2026-11-20T00:00:00.000Z"));
    const a = await syncNow(ws, device([print, transport]), api(store));
    const b = await syncNow(ws, device([]), api(store));
    expect(b.expenses).toHaveLength(2);
    const b2 = await syncNow(ws, { ...b, expenses: [print], tombstones: { "seed-transport": "2026-11-21T00:00:00.000Z" } }, api(store));
    expect(b2.expenses.map((e) => e.id)).toEqual(["seed-print"]);
    const a2 = await syncNow(ws, a, api(store));
    expect(a2.expenses.map((e) => e.id)).toEqual(["seed-print"]);
  });

  it("다른 기기가 먼저 올렸으면 다시 받아 합친 뒤 올린다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const [print, transport] = seedExpenses().map((e) => at(e, "2026-11-20T00:00:00.000Z"));
    await syncNow(ws, device([print]), api(store));
    // 받은 직후 다른 기기가 끼어드는 상황
    const real = api(store);
    let raced = false;
    const racy: SyncApi = { ...real, putDoc: async (id, token, body) => {
      if (!raced) { raced = true; await syncNow(ws, device([print, transport]), real); }
      return real.putDoc(id, token, body);
    } };
    const out = await syncNow(ws, device([print, at(demoSnackExpense(), "2026-11-22T00:00:00.000Z")]), racy);
    expect(out.expenses.map((e) => e.id).sort()).toEqual(["demo-snack", "seed-print", "seed-transport"]);
  });

  it("열쇠가 다르면 읽지도 쓰지도 못한다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    await syncNow(ws, device(seedExpenses()), api(store));
    const wrong = { id: ws.id, key: newWorkspace().key };
    await expect(syncNow(wrong, device([]), api(store))).rejects.toThrow(SyncError);
    const r = await putDoc(store, ws.id, await writeToken(wrong), { baseVersion: 1, data: "x" });
    expect(r.status).toBe(403);
    expect((await putImage(store, ws.id, "e1", await writeToken(wrong), { data: "x" })).status).toBe(403);
    expect((await putDoc(store, ws.id, null, { baseVersion: 1, data: "x" })).status).toBe(401);
  });

  it("문서는 덮어쓰지 않고 버전마다 새로 쓰며, 같은 버전을 동시에 쓰면 한쪽만 성공한다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const token = await writeToken(ws);
    const [a, b] = await Promise.all([putDoc(store, ws.id, token, { baseVersion: 0, data: "A" }), putDoc(store, ws.id, token, { baseVersion: 0, data: "B" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    for (let v = 1; v <= 5; v++) expect((await putDoc(store, ws.id, token, { baseVersion: v, data: `v${v + 1}` })).status).toBe(200);
    const got = await (await getDoc(store, ws.id)).json();
    expect(got).toMatchObject({ version: 6, data: "v6" });
    // 오래된 버전은 정리한다
    const docs = (await store.list(`sync/${ws.id}/doc-`)).sort();
    expect(docs.length).toBeLessThanOrEqual(4);
    expect(docs.at(-1)).toContain("doc-00000006.json");
    // 예전 버전 위에 쓰려 하면 최신 내용을 돌려준다
    const stale = await putDoc(store, ws.id, token, { baseVersion: 2, data: "old" });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: 6, data: "v6" });
  });

  it("서버 검증: 잘못된 주소, 너무 큰 문서, 저장소 미연결", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const token = await writeToken(ws);
    expect((await getDoc(store, "../etc")).status).toBe(400);
    expect((await getDoc(store, ws.id)).status).toBe(404);
    expect((await putDoc(store, ws.id, token, { baseVersion: 0, data: "x".repeat(3_000_001) })).status).toBe(413);
    expect((await putDoc(store, ws.id, token, { data: "x" })).status).toBe(400);
    expect((await getImage(store, ws.id, "a/b")).status).toBe(400);
    expect((await getDoc(null, ws.id)).status).toBe(503);
    await expect(syncNow(ws, device([]), api(null))).rejects.toThrow("연결되지 않았습니다");
  });

  it("문서에는 이미지 대신 자리표시만 들어간다", () => {
    const e = { ...demoSnackExpense(), evidence: { kind: "receipt" as const, image: BIG } };
    expect(stripImages([e])[0].evidence.image).toBe(IMAGE_REF);
    expect(stripImages(seedExpenses())[0].evidence.image).not.toBe(IMAGE_REF); // 시드의 작은 자리표시 이미지는 그대로
  });
});

describe("저장소 호출 줄이기", () => {
  /** 저장소를 감싸 어떤 일을 몇 번 시켰는지 센다. 목록 조회와 쓰기는 저장소가 엄격히 세는 일이다. */
  function counting(store: MemoryStore) {
    const n = { get: 0, put: 0, list: 0, del: 0 };
    const wrapped: SyncStore = {
      get: (k) => { n.get++; return store.get(k); },
      put: (k, v) => { n.put++; return store.put(k, v); },
      putNew: (k, v) => { n.put++; return store.putNew(k, v); },
      list: (p) => { n.list++; return store.list(p); },
      del: (k) => { n.del++; return store.del(k); },
    };
    return { n, wrapped, reset: () => { n.get = n.put = n.list = n.del = 0; } };
  }
  const snack = () => at({ ...demoSnackExpense(), evidence: { kind: "receipt" as const, image: BIG } }, "2026-11-20T10:00:00.000Z");

  it("바뀐 것이 없으면 다시 동기화해도 쓰지 않고 목록도 조회하지 않는다", async () => {
    const c = counting(new MemoryStore());
    const ws = newWorkspace();
    const a1 = await syncNow(ws, device([snack()]), api(c.wrapped), "2026-11-20T10:01:00.000Z");
    c.reset();
    const a2 = await syncNow(ws, a1, api(c.wrapped), "2026-11-20T10:02:00.000Z");
    expect(a2.version).toBe(a1.version);
    expect(a2.changed).toBe(false);
    expect(c.n).toEqual({ get: 2, put: 0, list: 0, del: 0 }); // 다음 버전이 있는지, 내가 아는 버전이 그대로인지
  });

  it("사진을 올릴 때 목록을 조회하지 않고, 기록 하나를 고치면 쓰기는 문서 한 번뿐이다", async () => {
    const c = counting(new MemoryStore());
    const ws = newWorkspace();
    const a1 = await syncNow(ws, device([snack()]), api(c.wrapped), "2026-11-20T10:01:00.000Z");
    // 처음 만들 때: 문서, 쓰기 증표 파일, 사진 한 장
    expect(c.n.put).toBe(3);
    c.reset();
    const edited = at({ ...a1.expenses[0], purpose: "고친 목적" }, "2026-11-20T10:05:00.000Z");
    const a2 = await syncNow(ws, { ...a1, expenses: [edited] }, api(c.wrapped), "2026-11-20T10:06:00.000Z");
    expect(a2.version).toBe(a1.version + 1);
    expect(c.n.put).toBe(1);
    expect(c.n.list).toBe(0);
  });

  it("다른 기기가 바꿨으면 목록 없이 다음 버전을 받아 온다. 많이 뒤처졌으면 목록으로 찾는다", async () => {
    const c = counting(new MemoryStore());
    const ws = newWorkspace();
    const a1 = await syncNow(ws, device([snack()]), api(c.wrapped), "2026-11-20T10:01:00.000Z");
    let b = await syncNow(ws, device([]), api(c.wrapped), "2026-11-20T10:02:00.000Z");
    b = await syncNow(ws, { ...b, expenses: [at({ ...b.expenses[0], amount: 1 }, "2026-11-20T10:03:00.000Z")] }, api(c.wrapped), "2026-11-20T10:03:00.000Z");
    c.reset();
    const a2 = await syncNow(ws, a1, api(c.wrapped), "2026-11-20T10:04:00.000Z");
    expect(a2.expenses[0].amount).toBe(1);
    expect(c.n.list).toBe(0);
    // 승인자 기기가 여덟 번 더 바꾼다 → 총무 기기가 아는 버전은 이미 지워졌다
    for (let i = 2; i < 10; i++) b = await syncNow(ws, { ...b, expenses: [at({ ...b.expenses[0], amount: i }, `2026-11-20T11:0${i}:00.000Z`)] }, api(c.wrapped), `2026-11-20T11:0${i}:00.000Z`);
    c.reset();
    const a3 = await syncNow(ws, a2, api(c.wrapped), "2026-11-20T12:00:00.000Z");
    expect(a3.expenses[0].amount).toBe(9);
    expect(a3.version).toBe(b.version);
    expect(c.n.list).toBe(1);
  });

  it("쓰기 증표 파일이 없는 예전 공간도 그대로 쓸 수 있고, 한 번 읽으면 파일이 만들어진다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const a1 = await syncNow(ws, device([snack()]), api(store), "2026-11-20T10:01:00.000Z");
    store.data.delete(`sync/${ws.id}/auth.json`); // 예전에 만든 공간처럼
    const a2 = await syncNow(ws, { ...a1, expenses: [at({ ...a1.expenses[0], amount: 5 }, "2026-11-20T10:05:00.000Z")] }, api(store), "2026-11-20T10:06:00.000Z");
    expect(a2.version).toBe(2);
    expect(store.data.has(`sync/${ws.id}/auth.json`)).toBe(true);
    // 열쇠가 다른 사람은 여전히 쓰지 못한다
    await expect(syncNow({ ...ws, key: newWorkspace().key }, device([snack()]), api(store))).rejects.toThrow();
  });
});

describe("더 많은 기록 담기", () => {
  const guided = (i: number): Expense => at({
    ...demoSnackExpense(), id: `e_${i}`, item: `행사 다과 ${i}`,
    guidance: { query: "", searchedAt: "2026-11-20T10:00:00.000Z", checklist: [{ text: "개인 카드 선결제는 환급 이체 확인증을 함께 보관하세요.", sourceUrl: "https://example.go.kr/guide/1" }],
      sources: Array.from({ length: 8 }, (_, k) => ({ title: `지원사업 회계 처리 안내 ${k}`, url: `https://example.go.kr/guide/${k}`, hostname: "example.go.kr", date: "2026-04-15", description: "보조금 집행 시 증빙서류는 지출결의서, 영수증, 참석자 명단을 갖추어야 한다. ".repeat(3) })) },
  }, "2026-11-20T10:00:00.000Z");

  it("압축한 글은 되돌리면 그대로이고, 압축하지 않은 예전 글도 읽는다", async () => {
    const text = JSON.stringify(Array.from({ length: 30 }, (_, i) => guided(i)));
    const packed = await packText(text);
    expect(packed.startsWith("z1:")).toBe(true);
    expect(packed.length).toBeLessThan(text.length / 4);
    expect(await unpackText(packed)).toBe(text);
    expect(await unpackText(text)).toBe(text);
  });

  it("문서에는 실제로 연결된 검색 결과만 싣고 긴 설명은 뺀다. 기기의 기록은 그대로다", () => {
    const e = guided(1);
    const [slim] = slimGuidance([e]);
    expect(slim.guidance!.sources).toEqual([{ title: "지원사업 회계 처리 안내 1", url: "https://example.go.kr/guide/1", hostname: "example.go.kr", date: "2026-04-15", description: "" }]);
    expect(slim.guidance!.checklist).toEqual(e.guidance!.checklist);
    expect(e.guidance!.sources).toHaveLength(8);
    const plain = at(demoSnackExpense(), "2026-11-20T10:00:00.000Z");
    expect(slimGuidance([plain])[0]).toBe(plain);
  });

  it("기록 200건이 서버 한도의 일부만 채우고, 다른 기기가 그대로 받는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const many = Array.from({ length: 200 }, (_, i) => guided(i));
    const a = await syncNow(ws, device(many), api(store), "2026-11-21T00:00:00.000Z");
    expect(a.docUsage).toBeGreaterThan(0);
    expect(a.docUsage).toBeLessThan(0.1);
    const b = await syncNow(ws, device([]), api(store), "2026-11-21T00:01:00.000Z");
    expect(b.expenses).toHaveLength(200);
    expect(b.expenses.find((e) => e.id === "e_7")!.guidance!.checklist).toHaveLength(1);
    expect(b.docUsage).toBe(0); // 받기만 했으니 올리지 않았다
  });

  it("압축하기 전에 만든 단체 공간의 문서도 읽는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const old = { v: 1, expenses: [at(demoSnackExpense(), "2026-11-20T10:00:00.000Z")], tombstones: {}, shared, sharedAt: "2026-11-01T00:00:00.000Z" };
    await putDoc(store, ws.id, await writeToken(ws), { baseVersion: 0, data: await encryptText(ws, JSON.stringify(old)) });
    const b = await syncNow(ws, device([]), api(store), "2026-11-21T00:01:00.000Z");
    expect(b.expenses.map((e) => e.id)).toEqual(["demo-snack"]);
  });
});

describe("원본 영수증과 후원자용 보기", () => {
  const ORIGINAL = "data:image/jpeg;base64," + "O".repeat(900);
  const withOriginal = () => at({ ...demoSnackExpense(), evidence: { kind: "receipt" as const, image: BIG, original: true } }, "2026-11-20T10:00:00.000Z");
  const sponsorOn = { ...shared, sponsorView: true, sponsorNames: false };

  it("원본은 구성원끼리만 암호화해 주고받는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const bagA = memoryBag();
    await bagA.put("demo-snack", ORIGINAL);
    await syncNow(ws, device([withOriginal()]), api(store), undefined, bagA);
    // 승인자 기기: 원본을 받아 자기 보관함에 넣는다
    const bagB = memoryBag();
    const b = await syncNow(ws, device([]), api(store), undefined, bagB);
    expect(b.expenses[0].evidence.original).toBe(true);
    expect(await bagB.get("demo-snack")).toBe(ORIGINAL);
    expect([...store.data.values()].join("")).not.toContain("OOOOOOOO");
    // 다시 동기화해도 원본을 또 올리지 않는다
    const puts: string[] = [];
    const counting: SyncApi = { ...api(store), putImage: async (id, eid, token, body, kind) => { puts.push(kind ?? "img"); return api(store).putImage(id, eid, token, body, kind); } };
    await syncNow(ws, b, counting, undefined, bagB);
    expect(puts).toEqual([]);
  });

  it("후원자 열쇠로는 후원자용 자료만 열 수 있고, 원본·기록·쓰기에는 접근하지 못한다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const bag = memoryBag();
    await bag.put("demo-snack", ORIGINAL);
    await syncNow(ws, device([withOriginal(), ...seedExpenses().map((e) => at(e, "2026-11-20T00:00:00.000Z"))], { shared: sponsorOn }), api(store), "2026-11-21T00:00:00.000Z", bag);

    const viewer = await viewerWorkspace(ws);
    expect(viewer.id).toBe(ws.id);
    expect(viewer.key).not.toBe(ws.key);
    expect(parseViewCode("#" + viewCode(viewer))).toEqual(viewer);
    expect(parseInvite("#" + viewCode(viewer))).toBeNull(); // 후원자 링크로는 구성원으로 참여할 수 없다

    // 후원자용 자료: 보고서와 영수증 목록, 이름은 가림
    const got = await api(store).getView(ws.id);
    const bundle = JSON.parse((await decryptText(viewer, got.body.data))!) as ViewBundle;
    expect(bundle.org).toBe("다온 나눔모임");
    expect(bundle.projects).toHaveLength(1);
    expect(bundle.projects[0].report.total).toBe(56900);
    expect(bundle.projects[0].receipts.map((r) => r.item).sort()).toEqual(["교통비", "인쇄물", "행사 다과"]);
    expect(bundle.projects[0].receipts.find((r) => r.id === "demo-snack")!.hasImage).toBe(true);
    expect(JSON.stringify(bundle)).not.toContain("김○○");
    expect(JSON.stringify(bundle)).not.toContain("OOOO");

    // 가린 사진은 후원자 열쇠로 열리고, 원본과 구성원용 자료는 열리지 않는다
    const vimg = await api(store).getImage(ws.id, "demo-snack", "view");
    expect(await decryptText(viewer, vimg.body.data)).toBe(BIG);
    const orig = await api(store).getImage(ws.id, "demo-snack", "orig");
    expect(await decryptText(viewer, orig.body.data)).toBeNull();
    expect(await decryptText(ws, orig.body.data)).toBe(ORIGINAL);
    const doc = await api(store).getDoc(ws.id);
    expect(await decryptText(viewer, doc.body.data)).toBeNull();

    // 후원자는 쓸 수 없다
    const fake = await writeToken(viewer);
    expect((await putDoc(store, ws.id, fake, { baseVersion: doc.body.version, data: "x" })).status).toBe(403);
    expect((await putView(store, ws.id, fake, { data: "x" })).status).toBe(403);
    expect((await putImage(store, ws.id, "demo-snack", fake, { data: "x" }, "view")).status).toBe(403);
  });

  it("후원자용 보기를 끄면 닫힘 표시로 바뀌고, 켜지 않았으면 아무것도 올리지 않는다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    const off = await syncNow(ws, device([withOriginal()]), api(store));
    expect((await api(store).getView(ws.id)).status).toBe(404);
    const on = await syncNow(ws, { ...off, shared: sponsorOn, sharedAt: "2026-11-22T00:00:00.000Z" }, api(store));
    const viewer = await viewerWorkspace(ws);
    const open = JSON.parse((await decryptText(viewer, (await api(store).getView(ws.id)).body.data))!) as ViewBundle;
    expect(open.disabled).toBeUndefined();
    await syncNow(ws, { ...on, shared: { ...sponsorOn, sponsorView: false }, sharedAt: "2026-11-23T00:00:00.000Z" }, api(store));
    const closed = JSON.parse((await decryptText(viewer, (await api(store).getView(ws.id)).body.data))!) as ViewBundle;
    expect(closed).toMatchObject({ disabled: true, projects: [] });
  });

  it("이름 표시를 켜면 후원자용 자료에도 이름이 들어간다", async () => {
    const store = new MemoryStore();
    const ws = newWorkspace();
    await syncNow(ws, device([withOriginal()], { shared: { ...sponsorOn, sponsorNames: true } }), api(store));
    const bundle = JSON.parse((await decryptText(await viewerWorkspace(ws), (await api(store).getView(ws.id)).body.data))!) as ViewBundle;
    expect(bundle.showNames).toBe(true);
    expect(JSON.stringify(bundle)).toContain("김○○");
  });
});
