// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 단체 공간 서버 저장소. 암호문만 보관한다.
 * 배포 환경에서는 Vercel Blob(비공개), 로컬 개발에서는 .data 폴더의 파일을 쓴다.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DOC_LIMIT } from "./sync-merge";

export interface SyncStore {
  get(key: string): Promise<string | null>;
  /** 덮어쓴다. */
  put(key: string, value: string): Promise<void>;
  /** 없을 때만 쓴다. 이미 있으면 false. */
  putNew(key: string, value: string): Promise<boolean>;
  /** 주어진 글자로 시작하는 키 목록. */
  list(prefix: string): Promise<string[]>;
  del(key: string): Promise<void>;
}
export const MAX_DOC_CHARS = DOC_LIMIT;
export const MAX_IMAGE_CHARS = 2_000_000;
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

class FileStore implements SyncStore {
  constructor(private dir: string) {}
  private name(key: string) {
    return key.replace(/\//g, "__").replace(/[^A-Za-z0-9_.-]/g, "_");
  }
  private file(key: string) {
    return path.join(this.dir, this.name(key));
  }
  async get(key: string) {
    try {
      return await readFile(this.file(key), "utf8");
    } catch {
      return null;
    }
  }
  async put(key: string, value: string) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file(key), value, "utf8");
  }
  async putNew(key: string, value: string) {
    await mkdir(this.dir, { recursive: true });
    try {
      await writeFile(this.file(key), value, { encoding: "utf8", flag: "wx" });
      return true;
    } catch {
      return false;
    }
  }
  async list(prefix: string) {
    try {
      const p = this.name(prefix);
      return (await readdir(this.dir)).filter((f) => f.startsWith(p)).map((f) => f.replace(/__/g, "/"));
    } catch {
      return [];
    }
  }
  async del(key: string) {
    await rm(this.file(key), { force: true });
  }
}

/** Vercel Blob(비공개). 같은 이름을 덮어쓰면 캐시 때문에 예전 내용이 읽힐 수 있어, 문서는 버전마다 새 이름으로 쓴다. */
class BlobStore implements SyncStore {
  async get(key: string) {
    const { get } = await import("@vercel/blob");
    const res = await get(key, { access: "private" });
    if (!res || !res.stream) return null;
    return await new Response(res.stream).text();
  }
  async put(key: string, value: string) {
    const { put } = await import("@vercel/blob");
    await put(key, value, { access: "private", allowOverwrite: true, addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 });
  }
  async putNew(key: string, value: string) {
    const { put } = await import("@vercel/blob");
    try {
      await put(key, value, { access: "private", allowOverwrite: false, addRandomSuffix: false, contentType: "application/json" });
      return true;
    } catch {
      return false;
    }
  }
  async list(prefix: string) {
    const { list } = await import("@vercel/blob");
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
  async del(key: string) {
    const { del } = await import("@vercel/blob");
    await del(key).catch(() => {});
  }
}

export class MemoryStore implements SyncStore {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async putNew(key: string, value: string) {
    if (this.data.has(key)) return false;
    this.data.set(key, value);
    return true;
  }
  async list(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
  async del(key: string) {
    this.data.delete(key);
  }
}

/** 쓸 수 있는 저장소. 배포 환경에 Blob 저장소가 연결되지 않았으면 null. */
export function defaultStore(): SyncStore | null {
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) return new BlobStore();
  if (process.env.VERCEL) return null;
  return new FileStore(path.join(process.cwd(), ".data", "sync"));
}

interface Envelope {
  version: number;
  tokenHash: string;
  updatedAt: string;
  data: string;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const ID = /^[A-Za-z0-9_-]{20,40}$/;
const EID = /^[A-Za-z0-9_-]{1,80}$/;
const NOT_SET = "단체 공간 저장소가 아직 연결되지 않았습니다. 관리자에게 문의해 주세요.";

// 저장 경로: sync/<단체 공간 id>/doc-<버전 8자리>.json
const docKey = (id: string, version: number) => `sync/${id}/doc-${String(version).padStart(8, "0")}.json`;
/** 가장 최근 버전의 문서. 문서는 버전마다 새 이름으로 쓰고 덮어쓰지 않는다. */
async function latest(store: SyncStore, id: string): Promise<Envelope | null> {
  const versions = (await store.list(`sync/${id}/doc-`)).map((k) => Number(k.match(/doc-(\d+)\.json$/)?.[1])).filter((n) => n > 0);
  if (!versions.length) return null;
  const raw = await store.get(docKey(id, Math.max(...versions)));
  return raw ? (JSON.parse(raw) as Envelope) : null;
}

// 쓰기 증표의 해시를 따로 둔 파일. 한 번 쓰고 바꾸지 않는다.
const authKey = (id: string) => `sync/${id}/auth.json`;
/**
 * 이 단체 공간에 쓸 수 있는 증표의 해시. 아직 만들어지지 않은 공간이면 null.
 * 예전에는 쓸 때마다 문서 목록을 조회해 최신 문서에서 꺼냈다. 저장소는 목록 조회 횟수를 엄격히 세므로
 * (사진 한 장 올릴 때마다 한 번씩이었다) 바뀌지 않는 작은 파일 하나를 읽는 것으로 바꿨다.
 */
async function tokenHashOf(store: SyncStore, id: string): Promise<string | null> {
  const raw = await store.get(authKey(id));
  if (raw) { try { return String(JSON.parse(raw).tokenHash); } catch { /* 깨졌으면 아래에서 다시 만든다 */ } }
  const env = await latest(store, id); // 예전에 만든 공간: 최신 문서에서 꺼내 파일로 옮겨 둔다
  if (!env) return null;
  await store.putNew(authKey(id), JSON.stringify({ tokenHash: env.tokenHash })).catch(() => {});
  return env.tokenHash;
}

/**
 * 문서 읽기. 암호문과 버전을 돌려준다.
 * since에 기기가 마지막으로 본 버전을 주면, 그 뒤로 바뀐 것이 없을 때 목록을 조회하지 않고 "그대로"라고만 답한다.
 * 응답의 now는 서버 시각이다. 기기는 이것으로 자기 시계가 얼마나 틀렸는지 안다.
 */
export async function getDoc(store: SyncStore | null, id: string, since = 0): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id)) return json({ error: "잘못된 단체 공간 주소입니다." }, 400);
  const now = new Date().toISOString();
  let env: Envelope | null = null;
  if (Number.isInteger(since) && since > 0) {
    // 다음 버전이 있는지 하나씩 들여다본다. 몇 버전 안 뒤처졌으면 목록 없이 따라잡는다.
    let v = since;
    let found: Envelope | null = null;
    for (let i = 0; i < 6; i++) {
      const raw = await store.get(docKey(id, v + 1));
      if (!raw) break;
      found = JSON.parse(raw) as Envelope;
      v++;
    }
    if (found && v - since < 6) env = found;
    else if (!found && (await store.get(docKey(id, since)))) return json({ version: since, unchanged: true, now });
    // 많이 뒤처졌거나, 기기가 아는 버전이 이미 지워졌으면 아래에서 목록으로 찾는다.
  }
  env ??= await latest(store, id);
  if (!env) return json({ error: "아직 만들어지지 않은 단체 공간입니다.", now }, 404);
  return json({ version: env.version, updatedAt: env.updatedAt, data: env.data, now });
}

/** 문서 쓰기. 열쇠를 가진 사람만(쓰기 증표), 그리고 마지막으로 읽은 버전 위에만 쓸 수 있다. */
export async function putDoc(store: SyncStore | null, id: string, token: string | null, body: any, now = new Date().toISOString()): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id)) return json({ error: "잘못된 단체 공간 주소입니다." }, 400);
  if (!token || token.length < 20) return json({ error: "쓰기 권한이 없습니다." }, 401);
  if (typeof body?.data !== "string" || !body.data || typeof body?.baseVersion !== "number") return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  if (body.data.length > MAX_DOC_CHARS) return json({ error: "기록이 너무 많아 한 번에 올릴 수 없습니다. 지난 사업의 기록을 백업한 뒤 정리해 주세요." }, 413);
  const known = await tokenHashOf(store, id);
  if (known && known !== sha256(token)) return json({ error: "쓰기 권한이 없습니다." }, 403);
  const base = body.baseVersion as number;
  // 어긋났을 때만 목록을 조회해 최신 문서를 함께 돌려준다 (드문 일이다).
  const conflict = async () => { const c = await latest(store, id); return json({ error: "다른 기기에서 먼저 바꿨습니다.", version: c?.version ?? 0, updatedAt: c?.updatedAt, data: c?.data, now }, 409); };
  // 기기가 읽은 버전이 지금도 있어야 한다 (없으면 너무 오래됐거나 없는 버전이다). 새 공간은 0에서 시작한다.
  if (base > 0 ? !(await store.get(docKey(id, base))) : !!known) return conflict();
  const next: Envelope = { version: base + 1, tokenHash: sha256(token), updatedAt: now, data: body.data };
  // 같은 버전을 두 기기가 동시에 쓰면 한쪽만 성공한다. 이미 다음 버전이 있어도 여기서 걸린다.
  if (!(await store.putNew(docKey(id, next.version), JSON.stringify(next)))) return conflict();
  if (!known) await store.putNew(authKey(id), JSON.stringify({ tokenHash: next.tokenHash })).catch(() => {});
  if (next.version > 3) await store.del(docKey(id, next.version - 3)).catch(() => {});
  return json({ version: next.version, updatedAt: now, now });
}

/** 쓰기 권한 확인. 서버는 쓰기 증표의 해시만 알고, 증표는 열쇠를 가진 기기만 만들 수 있다. */
async function authorized(store: SyncStore, id: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const known = await tokenHashOf(store, id);
  return !!known && known === sha256(token);
}

/** 이미지 종류: img 가린 사진(구성원용), orig 원본(구성원용), view 가린 사진(후원자용 열쇠로 암호화). */
export type ImageKind = "img" | "orig" | "view";
const KIND_DIR: Record<ImageKind, string> = { img: "img", orig: "orig", view: "vimg" };
export const imageKind = (v: string | null): ImageKind => (v === "orig" || v === "view" ? v : "img");

export async function getImage(store: SyncStore | null, id: string, eid: string, kind: ImageKind = "img"): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id) || !EID.test(eid)) return json({ error: "잘못된 주소입니다." }, 400);
  const raw = await store.get(`sync/${id}/${KIND_DIR[kind]}/${eid}`);
  return raw ? json({ data: raw }) : json({ error: "이미지가 없습니다." }, 404);
}
export async function putImage(store: SyncStore | null, id: string, eid: string, token: string | null, body: any, kind: ImageKind = "img"): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id) || !EID.test(eid)) return json({ error: "잘못된 주소입니다." }, 400);
  if (typeof body?.data !== "string" || !body.data) return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  if (body.data.length > MAX_IMAGE_CHARS) return json({ error: "이미지가 너무 큽니다." }, 413);
  if (!(await authorized(store, id, token))) return json({ error: "쓰기 권한이 없습니다." }, 403);
  await store.put(`sync/${id}/${KIND_DIR[kind]}/${eid}`, body.data);
  return json({ ok: true });
}

/** 사진 한 장을 지운다. 구성원만 할 수 있다. */
export async function delImage(store: SyncStore | null, id: string, eid: string, token: string | null, kind: ImageKind = "img"): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id) || !EID.test(eid)) return json({ error: "잘못된 주소입니다." }, 400);
  if (!(await authorized(store, id, token))) return json({ error: "쓰기 권한이 없습니다." }, 403);
  await store.del(`sync/${id}/${KIND_DIR[kind]}/${eid}`);
  return json({ ok: true });
}
/**
 * 기록 한 건에 딸린 사진을 모두 지운다: 가린 사진, 원본, 후원자용 사진, 그리고 함께 묶은 자료의 사진까지.
 * 기록을 지웠을 때 부른다. 사진 이름은 "기록 id" 또는 "기록 id-x-자료 id"다 (lib/photos.ts).
 */
export async function purgeRecordImages(store: SyncStore | null, id: string, eid: string, token: string | null): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id) || !EID.test(eid)) return json({ error: "잘못된 주소입니다." }, 400);
  if (!(await authorized(store, id, token))) return json({ error: "쓰기 권한이 없습니다." }, 403);
  let removed = 0;
  for (const dir of Object.values(KIND_DIR)) {
    const base = `sync/${id}/${dir}/${eid}`;
    // 이름이 비슷한 다른 기록(예: e_1과 e_10)의 사진을 건드리지 않도록 정확히 가려낸다.
    for (const k of await store.list(base)) if (k === base || k.startsWith(`${base}-x-`)) { await store.del(k); removed++; }
  }
  return json({ ok: true, removed });
}

/**
 * 후원자용으로 올려 둔 사진을 모두 지운다. 후원자용 보기를 닫을 때 부른다.
 * 닫힘 표시만 올리고 사진을 남겨 두면, 예전 링크를 가진 사람이 사진을 계속 받아 열 수 있다.
 */
export async function clearViewImages(store: SyncStore | null, id: string, token: string | null): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id)) return json({ error: "잘못된 주소입니다." }, 400);
  if (!(await authorized(store, id, token))) return json({ error: "쓰기 권한이 없습니다." }, 403);
  const keys = await store.list(`sync/${id}/${KIND_DIR.view}/`);
  for (const k of keys) await store.del(k);
  return json({ ok: true, removed: keys.length });
}

/* ---------- 후원자용 보기 자료 (후원자 열쇠로 암호화된 것) ---------- */
const viewKey = (id: string, n: number) => `sync/${id}/view-${String(n).padStart(8, "0")}.json`;
async function viewNumbers(store: SyncStore, id: string): Promise<number[]> {
  return (await store.list(`sync/${id}/view-`)).map((k) => Number(k.match(/view-(\d+)\.json$/)?.[1])).filter((n) => n > 0);
}
/** 누구나 읽을 수 있지만, 후원자용 열쇠가 있어야 내용을 열 수 있다. */
export async function getView(store: SyncStore | null, id: string): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id)) return json({ error: "잘못된 주소입니다." }, 400);
  const nums = await viewNumbers(store, id);
  const raw = nums.length ? await store.get(viewKey(id, Math.max(...nums))) : null;
  return raw ? json({ data: raw }) : json({ error: "공유된 결산보고서가 없습니다." }, 404);
}
/** 구성원만 쓸 수 있다. 덮어쓰지 않고 새 번호로 쓴다. */
export async function putView(store: SyncStore | null, id: string, token: string | null, body: any): Promise<Response> {
  if (!store) return json({ error: NOT_SET }, 503);
  if (!ID.test(id)) return json({ error: "잘못된 주소입니다." }, 400);
  if (typeof body?.data !== "string" || !body.data) return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  if (body.data.length > MAX_DOC_CHARS) return json({ error: "보고서가 너무 큽니다." }, 413);
  if (!(await authorized(store, id, token))) return json({ error: "쓰기 권한이 없습니다." }, 403);
  for (let attempt = 0; attempt < 3; attempt++) {
    const nums = await viewNumbers(store, id);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    if (await store.putNew(viewKey(id, next), body.data)) {
      for (const n of nums) if (n < next - 2) await store.del(viewKey(id, n)).catch(() => {});
      return json({ ok: true });
    }
  }
  return json({ error: "잠시 후 다시 시도해 주세요." }, 409);
}
