// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 단체 공간 동기화. 서버에서 받아 합치고, 합친 결과를 다시 올린다.
 * 다른 기기가 먼저 올렸으면(409) 다시 받아 합친 뒤 재시도한다.
 */
import { mergeLedgers, recordsFingerprint, summarize, type Ledger, type Problem } from "./ledger";
import type { ImageBag } from "./originals";
import { photosOf, slotsOf } from "./photos";
import { buildViewBundle, viewImages } from "./sponsor-view";
import { decryptText, encryptText, viewerWorkspace, writeToken, type Workspace } from "./sync-crypto";
import { IMAGE_REF, imagesOf, mergeExpenses, restoreImages, stripImages, type SharedSettings, type SyncDoc, type Tombstones } from "./sync-merge";
import type { Expense } from "./types";

export interface SyncApi {
  getDoc(id: string): Promise<{ status: number; body: any }>;
  putDoc(id: string, token: string, body: unknown): Promise<{ status: number; body: any }>;
  getImage(id: string, eid: string, kind?: "img" | "orig" | "view"): Promise<{ status: number; body: any }>;
  putImage(id: string, eid: string, token: string, body: unknown, kind?: "img" | "orig" | "view"): Promise<{ status: number; body: any }>;
  delImage(id: string, eid: string, token: string, kind?: "img" | "orig" | "view"): Promise<{ status: number; body: any }>;
  /** 기록 한 건에 딸린 사진을 모두 지운다 (가린 사진, 원본, 후원자용, 함께 묶은 자료) */
  purgeRecord(id: string, eid: string, token: string): Promise<{ status: number; body: any }>;
  getView(id: string): Promise<{ status: number; body: any }>;
  /** 후원자용으로 올려 둔 사진을 모두 지운다 */
  clearView(id: string, token: string): Promise<{ status: number; body: any }>;
  putView(id: string, token: string, body: unknown): Promise<{ status: number; body: any }>;
}
export interface SyncLocal {
  expenses: Expense[];
  tombstones: Tombstones;
  shared: SharedSettings;
  /** 공유 설정을 마지막으로 바꾼 시각 */
  sharedAt: string;
  /** 이미 올린 이미지 표식 (기록 id:길이) */
  uploaded: string[];
  /** 이 기기가 가진 서명 원장 사본 */
  ledger?: Ledger;
}
export interface SyncResult extends SyncLocal {
  ledger: Ledger;
  /** 받은 원장을 검증하다 발견한 문제. 문제가 있는 원장은 받지 않았다. */
  ledgerProblems: Problem[];
  version: number;
  syncedAt: string;
  /** 다른 기기에서 온 변경으로 이 기기의 기록이 바뀌었는지 */
  changed: boolean;
  /** 아직 받지 못한 이미지 수 */
  missingImages: number;
  /** 두 기기의 수정이 섞여 새로 만들어진 기록의 id. 이 기기가 그 내용에 서명해 둔다 */
  mergedIds: string[];
  /** 이번에 올리려다 실패한 사진 수 (너무 크거나 서버가 받지 않음). 다음 동기화 때 다시 시도한다 */
  failedUploads: number;
}
export class SyncError extends Error {}

/** 후원자용 보기를 닫고 서버의 사진을 지웠다는 표식 */
const VIEW_CLEARED = "view-cleared";
/** 지운 기록의 사진을 서버에서 지웠다는 표식의 머리말 */
const GONE = "gone:";
/** 올렸다는 표식에서 사진 이름을 꺼낸다. 사진 표식이 아니면 null. 표식은 "이름:길이"(가린 사진), "o:이름"(원본), "v:이름:길이"(후원자용)다. */
function photoKeyOfMark(u: string): string | null {
  if (u.startsWith("view:") || u.startsWith(GONE) || !u.includes(":")) return null;
  if (u.startsWith("o:")) return u.slice(2);
  if (u.startsWith("v:")) return u.slice(2, u.lastIndexOf(":"));
  return u.slice(0, u.lastIndexOf(":"));
}
const mark = (id: string, image: string) => `${id}:${image.length}`;
const uniq = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))];

export async function syncNow(ws: Workspace, local: SyncLocal, api: SyncApi, now = new Date().toISOString(), originals?: ImageBag): Promise<SyncResult> {
  const token = await writeToken(ws);
  for (let attempt = 0; attempt < 4; attempt++) {
    const got = await api.getDoc(ws.id);
    let remote: SyncDoc = { v: 1, expenses: [], tombstones: {}, shared: local.shared, sharedAt: "" };
    let version = 0;
    if (got.status === 200) {
      const text = await decryptText(ws, got.body.data);
      if (text === null) throw new SyncError("이 초대 링크로는 단체 공간을 열 수 없습니다. 링크를 다시 받아 주세요.");
      remote = JSON.parse(text) as SyncDoc;
      version = got.body.version;
    } else if (got.status !== 404) {
      throw new SyncError(got.body?.error || "단체 공간에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }

    const have = imagesOf(local.expenses);
    const merged = mergeExpenses(local.expenses, restoreImages(remote.expenses, have), local.tombstones, remote.tombstones);
    const remoteNewer = (Date.parse(remote.sharedAt) || 0) > (Date.parse(local.sharedAt) || 0);
    const base = remoteNewer ? remote.shared : local.shared;
    const shared: SharedSettings = { ...base, projects: uniq([...base.projects, ...(remoteNewer ? local.shared.projects : remote.shared.projects)]) };
    const sharedAt = remoteNewer ? remote.sharedAt : local.sharedAt || now;

    // 원장: 받은 사본을 검증해 합친다. 내 사본이 더 길면 내 것이 올라가 다른 기기가 따라잡는다.
    const led = await mergeLedgers(local.ledger ?? {}, remote.ledger ?? {});

    const doc: SyncDoc = { v: 1, expenses: stripImages(merged.expenses), tombstones: merged.tombstones, shared, sharedAt, ledger: led.ledger };
    const put = await api.putDoc(ws.id, token, { baseVersion: version, data: await encryptText(ws, JSON.stringify(doc)) });
    if (put.status === 409) continue;
    if (put.status !== 200) throw new SyncError(put.body?.error || "단체 공간에 저장하지 못했습니다.");

    // 이미지: 아직 안 올린 것은 올리고, 이 기기에 없는 것은 받는다.
    const uploaded = new Set(local.uploaded);
    let expenses = merged.expenses;
    // 영수증과 함께 묶은 자료(거래명세서 등)를 사진 이름별로 하나씩 다룬다.
    let failedUploads = 0;
    for (const p of expenses.flatMap(photosOf)) {
      if (uploaded.has(mark(p.key, p.image))) continue;
      const res = await api.putImage(ws.id, p.key, token, { data: await encryptText(ws, p.image) });
      if (res.status === 200) uploaded.add(mark(p.key, p.image));
      else failedUploads++; // 조용히 넘기지 않고 세어 둔다. 올린 사람에게 알려야 한다.
    }
    let missingImages = 0;
    const fetched = new Map<string, string>();
    for (const s of expenses.flatMap(slotsOf)) {
      if (s.image !== IMAGE_REF) continue;
      const res = await api.getImage(ws.id, s.key);
      const img = res.status === 200 ? await decryptText(ws, res.body.data) : null;
      if (img) {
        fetched.set(s.key, img);
        uploaded.add(mark(s.key, img));
      } else missingImages++;
    }
    if (fetched.size) expenses = restoreImages(expenses, fetched);

    // 원본 사진: 구성원 열쇠로 암호화해 구성원끼리만 주고받는다.
    if (originals) {
      for (const s of expenses.flatMap(slotsOf)) {
        if (!s.original) continue;
        const have = await originals.get(s.key);
        if (have && !uploaded.has(`o:${s.key}`)) {
          const res = await api.putImage(ws.id, s.key, token, { data: await encryptText(ws, have) }, "orig");
          if (res.status === 200) uploaded.add(`o:${s.key}`);
          else failedUploads++;
        } else if (!have) {
          const res = await api.getImage(ws.id, s.key, "orig");
          const img = res.status === 200 ? await decryptText(ws, res.body.data) : null;
          if (img) {
            await originals.put(s.key, img);
            uploaded.add(`o:${s.key}`);
          }
        }
      }
    }

    // 지운 기록의 사진을 서버에서도 지운다. 삭제 기록은 모든 기기에 전해지므로, 사진을 올린 적 없는 기기도 지울 수 있다.
    // 지웠다는 표식(gone:)을 남겨 한 번만 부른다.
    for (const id of Object.keys(merged.tombstones)) {
      if (uploaded.has(`${GONE}${id}`)) continue;
      const res = await api.purgeRecord(ws.id, id, token);
      if (res.status !== 200) continue;
      uploaded.add(`${GONE}${id}`);
      for (const u of [...uploaded]) {
        const key = photoKeyOfMark(u);
        if (key !== null && (key === id || key.startsWith(`${id}-x-`))) uploaded.delete(u);
      }
    }
    // 뗀 자료의 사진: 내가 올렸다는 표식은 있는데 지금 어느 기록에도 없는 사진은 서버에서 지운다.
    const live = new Set(expenses.flatMap(slotsOf).map((s) => s.key));
    for (const u of [...uploaded]) {
      const key = photoKeyOfMark(u);
      if (key === null || u.startsWith("v:") || live.has(key)) continue; // 후원자용(v:)은 아래에서 따로 정리한다
      const res = await api.delImage(ws.id, key, token, u.startsWith("o:") ? "orig" : "img");
      if (res.status === 200) uploaded.delete(u);
    }

    // 후원자용 보기: 켜져 있으면 결산보고서와 가린 사진을 후원자 열쇠로 암호화해 올린다. 꺼져 있으면 닫힘 표시만 올린다.
    const viewOn = shared.sponsorView === true;
    // 후원자가 나중에 바뀌었는지 견줄 수 있게 지문을 함께 낸다.
    const prints: Record<string, string> = {};
    if (viewOn) for (const p of new Set(expenses.map((e) => e.project).filter(Boolean))) prints[p] = await recordsFingerprint(expenses.filter((e) => e.project === p));
    const proof = viewOn ? { ledger: await summarize(led.ledger), prints } : undefined;
    const bundle = buildViewBundle(expenses, shared.org, { enabled: viewOn, showNames: shared.sponsorNames === true }, now, proof);
    const bundleSig = `view:${JSON.stringify({ ...bundle, publishedAt: "" }).length}:${viewOn}:${JSON.stringify(bundle.projects.map((p) => [p.project, p.report.total, p.report.count, p.receipts.length, p.report.openItems.length, p.report.approvedTotal]))}`;
    const hadView = [...uploaded].some((u) => u.startsWith("view:"));
    if ((viewOn || hadView) && !uploaded.has(bundleSig)) {
      const viewer = await viewerWorkspace(ws);
      const res = await api.putView(ws.id, token, { data: await encryptText(viewer, JSON.stringify(bundle)) });
      if (res.status === 200) {
        for (const u of [...uploaded]) if (u.startsWith("view:")) uploaded.delete(u);
        uploaded.add(bundleSig);
      }
    }
    // 후원자용 사진은 보고서 묶음과 따로 챙긴다. 보고서가 그대로여도, 지난번에 올리지 못한 사진이나
    // 바꿔 붙인 사진은 이번에 올린다 (예전에는 보고서가 바뀔 때만 올려서 사진이 빠진 채 남을 수 있었다).
    const viewMarks = [...uploaded].filter((u) => u.startsWith("v:"));
    if (viewOn) {
      const viewer = await viewerWorkspace(ws);
      const wanted = viewImages(expenses);
      for (const [key, img] of wanted) {
        const m = `v:${key}:${img.length}`;
        if (uploaded.has(m)) continue;
        const up = await api.putImage(ws.id, key, token, { data: await encryptText(viewer, img) }, "view");
        if (up.status === 200) uploaded.add(m);
        else failedUploads++;
      }
      // 지운 기록이나 뗀 자료의 사진은 후원자용 자리에서도 지운다.
      for (const m of viewMarks) {
        const key = m.slice(2, m.lastIndexOf(":"));
        if (wanted.has(key)) { if (m !== `v:${key}:${wanted.get(key)!.length}`) uploaded.delete(m); continue; }
        const res = await api.delImage(ws.id, key, token, "view");
        if (res.status === 200) uploaded.delete(m);
      }
      uploaded.delete(VIEW_CLEARED);
    } else if (viewMarks.length || (hadView && !uploaded.has(VIEW_CLEARED))) {
      // 후원자용 보기를 닫으면 올려 둔 사진을 서버에서 모두 지운다. 닫힘 표시만으로는 예전 링크를 가진 사람이
      // 사진을 계속 받아 열 수 있다. 어느 기기가 닫았든, 닫힌 것을 본 기기가 지우기를 시도한다 (여러 번 해도 같다).
      const res = await api.clearView(ws.id, token);
      // 다시 열면 모든 사진을 새로 올리도록, 올렸다는 표식도 지운다.
      // 지웠다는 표식을 남겨, 닫혀 있는 동안 동기화할 때마다 다시 부르지 않는다.
      if (res.status === 200) {
        for (const m of viewMarks) uploaded.delete(m);
        uploaded.add(VIEW_CLEARED);
      }
    }

    const sig = (l: Expense[]) => JSON.stringify([...l].sort((a, b) => a.id.localeCompare(b.id)));
    return {
      expenses, tombstones: merged.tombstones, shared, sharedAt, uploaded: [...uploaded], ledger: led.ledger, ledgerProblems: led.problems,
      version: put.body.version, syncedAt: now, missingImages, failedUploads, mergedIds: merged.merged,
      changed: sig(expenses) !== sig(local.expenses) || JSON.stringify(shared) !== JSON.stringify(local.shared),
    };
  }
  throw new SyncError("다른 기기와 동시에 저장하고 있습니다. 잠시 후 다시 시도해 주세요.");
}

/** 브라우저에서 쓰는 API 구현. */
export function httpApi(fetchImpl: typeof fetch = fetch): SyncApi {
  const call = async (url: string, init?: RequestInit) => {
    try {
      const res = await fetchImpl(url, init);
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } catch {
      throw new SyncError("네트워크에 연결하지 못했습니다. 기록은 이 기기에 그대로 있습니다.");
    }
  };
  const put = (url: string, token: string, body: unknown) => call(url, { method: "PUT", headers: { "Content-Type": "application/json", "x-write-token": token }, body: JSON.stringify(body) });
  return {
    getDoc: (id) => call(`/api/sync/${id}`),
    putDoc: (id, token, body) => put(`/api/sync/${id}`, token, body),
    getImage: (id, eid, kind = "img") => call(`/api/sync/${id}/img/${encodeURIComponent(eid)}?kind=${kind}`),
    putImage: (id, eid, token, body, kind = "img") => put(`/api/sync/${id}/img/${encodeURIComponent(eid)}?kind=${kind}`, token, body),
    delImage: (id, eid, token, kind = "img") => call(`/api/sync/${id}/img/${encodeURIComponent(eid)}?kind=${kind}`, { method: "DELETE", headers: { "x-write-token": token } }),
    purgeRecord: (id, eid, token) => call(`/api/sync/${id}/img/${encodeURIComponent(eid)}?kind=all`, { method: "DELETE", headers: { "x-write-token": token } }),
    getView: (id) => call(`/api/sync/${id}/view`),
    clearView: (id, token) => call(`/api/sync/${id}/view`, { method: "DELETE", headers: { "x-write-token": token } }),
    putView: (id, token, body) => put(`/api/sync/${id}/view`, token, body),
  };
}

/* ---------- 이 기기에 보관하는 동기화 상태 ---------- */
export const SYNC_KEY = "open-receipt:sync:v1";
export interface SyncMeta {
  ws: Workspace | null;
  version: number;
  uploaded: string[];
  tombstones: Tombstones;
  sharedAt: string;
  syncedAt: string;
}
export const EMPTY_META: SyncMeta = { ws: null, version: 0, uploaded: [], tombstones: {}, sharedAt: "", syncedAt: "" };
export function loadMeta(kv: { getItem(k: string): string | null }): SyncMeta {
  try {
    const d = JSON.parse(kv.getItem(SYNC_KEY) ?? "null");
    if (!d || typeof d !== "object") return { ...EMPTY_META };
    return {
      ws: d.ws && typeof d.ws.id === "string" && typeof d.ws.key === "string" ? { id: d.ws.id, key: d.ws.key } : null,
      version: Number(d.version) || 0,
      uploaded: Array.isArray(d.uploaded) ? d.uploaded.map(String) : [],
      tombstones: d.tombstones && typeof d.tombstones === "object" ? d.tombstones : {},
      sharedAt: typeof d.sharedAt === "string" ? d.sharedAt : "",
      syncedAt: typeof d.syncedAt === "string" ? d.syncedAt : "",
    };
  } catch {
    return { ...EMPTY_META };
  }
}
export function saveMeta(kv: { setItem(k: string, v: string): void }, m: SyncMeta): void {
  try {
    kv.setItem(SYNC_KEY, JSON.stringify(m));
  } catch {
    /* 저장 공간이 부족하면 다음 동기화 때 다시 맞춘다 */
  }
}
