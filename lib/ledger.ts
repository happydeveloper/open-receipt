// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 서명 원장. 기기마다 서명 열쇠를 하나 만들고, 기록을 올리거나 고치거나 승인하거나 지울 때마다
 * 자기 원장에 한 줄을 덧붙인다. 각 줄은 앞줄의 해시를 담고(해시 체인) 그 기기의 열쇠로 서명한다.
 *
 * - 원장은 기기(열쇠)마다 따로 있다. 여러 기기가 동시에 써도 서로의 줄과 충돌하지 않는다.
 * - 동기화할 때 모든 기기가 모든 원장의 사본을 받아 검증한다. 한 곳에서 줄을 고치거나 잘라 내면
 *   다른 기기의 사본과 어긋나서 드러난다.
 * - 원장 전체의 지문(해시)을 결산보고서와 함께 내보내, 받은 사람이 나중에 바뀌었는지 견줄 수 있게 한다.
 *
 * 원장이 보장하는 것은 "기록이 그 열쇠로 서명된 뒤 바뀌지 않았다"이다. 기록 내용이 사실인지는 보장하지 않는다.
 */
import type { Expense } from "./types";

export type Role = "submitter" | "approver";
export type EntryType = "record" | "approve" | "delete";

export interface Entry {
  v: 1;
  /** 서명한 기기의 열쇠 id (공개 열쇠의 해시) */
  key: string;
  /** 이 원장에서 몇 번째 줄인지 (0부터) */
  seq: number;
  /** 앞줄의 해시. 첫 줄은 빈 문자열 */
  prev: string;
  at: string;
  /** 서명할 때 그 기기가 밝힌 이름과 역할 */
  name: string;
  role: Role;
  type: EntryType;
  /** 지출 기록 id */
  id: string;
  /** 이 줄을 쓴 뒤의 기록 내용 해시. 삭제는 빈 문자열 */
  digest: string;
  /** 승인일 때: 승인하기 전 기록 내용 해시 */
  base?: string;
  /** 가린 영수증 사진의 해시 (사진이 있을 때) */
  img?: string;
  sig: string;
}
export interface Chain {
  pub: JsonWebKey;
  entries: Entry[];
}
/** 열쇠 id → 그 기기의 원장 */
export type Ledger = Record<string, Chain>;
export interface Identity {
  key: string;
  pub: JsonWebKey;
  priv: JsonWebKey;
}

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;
const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** 키 순서와 무관하게 같은 값이면 같은 문자열이 되게 한다. undefined는 뺀다. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
export async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

const pubOnly = (j: JsonWebKey): JsonWebKey => ({ kty: j.kty, crv: j.crv, x: j.x, y: j.y });
export const keyIdOf = async (pub: JsonWebKey) => (await sha256(canonical(pubOnly(pub)))).slice(0, 32);

/** 이 기기의 서명 열쇠를 만든다. 비밀 열쇠는 기기 밖으로 내보내지 않는다. */
export async function createIdentity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
  const pub = pubOnly(await crypto.subtle.exportKey("jwk", pair.publicKey));
  const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { key: await keyIdOf(pub), pub, priv };
}

/** 기록에서 서명할 내용. 사진, 동기화 시각, 이력, AI 안내처럼 내용이 아닌 것은 뺀다. */
export function recordBody(e: Expense) {
  return {
    id: e.id, date: e.date, item: e.item, amount: e.amount, merchant: e.merchant, purpose: e.purpose,
    project: e.project, budgetCategory: e.budgetCategory, paymentMethod: e.paymentMethod, payer: e.payer,
    reimbursement: e.reimbursement,
    // 함께 묶은 자료는 있을 때만 넣는다 (자료가 없는 예전 기록의 서명이 그대로 맞도록).
    evidence: { kind: e.evidence.kind, altType: e.evidence.altType ?? "", reason: e.evidence.reason ?? "", ...(e.evidence.extra?.length ? { extra: e.evidence.extra.map((a) => ({ id: a.id, label: a.label })) } : {}) },
    confirmed: e.confirmed, submittedBy: e.submittedBy, approvedBy: e.approvedBy ?? "", approvedAt: e.approvedAt ?? "",
  };
}
export const recordDigest = (e: Expense) => sha256(canonical(recordBody(e)));
const isPhoto = (s?: string) => !!s && s.length > 200;

const unsigned = (e: Entry) => { const { sig: _sig, ...rest } = e; return rest; };
export const entryHash = (e: Entry) => sha256(canonical(e));

export type EntryInput = Pick<Entry, "type" | "id" | "digest"> & Partial<Pick<Entry, "base" | "img">>;
/** 내 원장에 한 줄을 덧붙인다. 원장 전체를 새 객체로 돌려준다. */
export async function appendEntry(ledger: Ledger, me: Identity, who: { name: string; role: Role }, input: EntryInput, at = new Date().toISOString()): Promise<Ledger> {
  const chain = ledger[me.key] ?? { pub: me.pub, entries: [] };
  const last = chain.entries.at(-1);
  const body: Omit<Entry, "sig"> = { v: 1, key: me.key, seq: chain.entries.length, prev: last ? await entryHash(last) : "", at, name: who.name, role: who.role, ...input };
  const priv = await crypto.subtle.importKey("jwk", me.priv, ALG, false, ["sign"]);
  const sig = b64(await crypto.subtle.sign(SIGN, priv, enc.encode(canonical(body))));
  return { ...ledger, [me.key]: { pub: chain.pub, entries: [...chain.entries, { ...body, sig }] } };
}

/** 기록 목록이 바뀌었을 때 내 원장에 쓸 줄을 정한다. 내용이 그대로인 기록은 줄을 만들지 않는다. */
export async function diffEntries(prev: Expense[], next: Expense[]): Promise<EntryInput[]> {
  const before = new Map(prev.map((e) => [e.id, e]));
  const out: EntryInput[] = [];
  for (const e of next) {
    const old = before.get(e.id);
    before.delete(e.id);
    const digest = await recordDigest(e);
    const oldDigest = old ? await recordDigest(old) : "";
    if (digest === oldDigest) continue;
    const img = isPhoto(e.evidence.image) ? await sha256(e.evidence.image!) : undefined;
    // 다른 내용은 그대로이고 승인만 새로 붙었으면 승인 줄이다.
    const base = old && e.approvedBy && !old.approvedBy ? await recordDigest({ ...e, approvedBy: undefined, approvedAt: undefined }) : "";
    if (base && base === oldDigest) out.push({ type: "approve", id: e.id, digest, base, img });
    else out.push({ type: "record", id: e.id, digest, img });
  }
  for (const id of before.keys()) out.push({ type: "delete", id, digest: "" });
  return out;
}

export interface Problem {
  key: string;
  /** 문제가 난 줄 번호. 원장 전체의 문제면 -1 */
  seq: number;
  text: string;
}
const short = (key: string) => key.slice(0, 8);

/** 한 기기의 원장을 검증한다: 열쇠 id, 순번, 앞줄 해시, 서명. */
export async function verifyChain(key: string, chain: Chain): Promise<Problem[]> {
  if ((await keyIdOf(chain.pub)) !== key) return [{ key, seq: -1, text: `원장 ${short(key)}의 공개 열쇠가 열쇠 id와 맞지 않습니다` }];
  let pub: CryptoKey;
  try {
    pub = await crypto.subtle.importKey("jwk", pubOnly(chain.pub), ALG, false, ["verify"]);
  } catch {
    return [{ key, seq: -1, text: `원장 ${short(key)}의 공개 열쇠를 읽을 수 없습니다` }];
  }
  let prev = "";
  for (let i = 0; i < chain.entries.length; i++) {
    const e = chain.entries[i];
    const bad = (text: string): Problem[] => [{ key, seq: i, text: `원장 ${short(key)}의 ${i + 1}번째 줄: ${text}` }];
    if (!e || e.key !== key || e.seq !== i) return bad("순번이 맞지 않습니다");
    if (e.prev !== prev) return bad("앞줄과 이어지지 않습니다 (중간이 바뀌었거나 빠졌습니다)");
    let ok = false;
    try {
      ok = await crypto.subtle.verify(SIGN, pub, unb64(e.sig) as BufferSource, enc.encode(canonical(unsigned(e))));
    } catch { /* 서명 형식이 틀리면 아래에서 거절 */ }
    if (!ok) return bad("서명이 맞지 않습니다");
    prev = await entryHash(e);
  }
  return [];
}

/**
 * 두 사본을 합친다. 같은 기기의 원장은 한쪽이 다른 쪽의 앞부분일 때만 긴 쪽을 받는다.
 * 검증에 실패한 원장은 받지 않고, 갈라진 원장(같은 순번에 다른 줄)은 이 기기의 사본을 지킨다.
 */
export async function mergeLedgers(local: Ledger, remote: Ledger): Promise<{ ledger: Ledger; problems: Problem[] }> {
  const out: Ledger = { ...local };
  const problems: Problem[] = [];
  for (const [key, theirs] of Object.entries(remote ?? {})) {
    if (!theirs || !Array.isArray(theirs.entries)) continue;
    const bad = await verifyChain(key, theirs);
    if (bad.length) { problems.push(...bad); continue; }
    const mine = out[key];
    if (!mine) { out[key] = theirs; continue; }
    const n = Math.min(mine.entries.length, theirs.entries.length);
    // 서명까지 같으면 같은 줄이다. 마지막 공통 줄만 견줘도 그 앞은 해시로 묶여 있다.
    if (n > 0 && mine.entries[n - 1].sig !== theirs.entries[n - 1].sig) {
      problems.push({ key, seq: n - 1, text: `원장 ${short(key)}이 이 기기의 사본과 다릅니다. 이 기기의 사본을 지켰습니다` });
      continue;
    }
    if (theirs.entries.length > mine.entries.length) out[key] = theirs;
  }
  return { ledger: out, problems };
}

/** 원장 전체의 지문. 어느 원장에든 줄이 하나라도 늘거나 바뀌면 달라진다. */
export async function ledgerHead(ledger: Ledger): Promise<string> {
  const heads: string[] = [];
  for (const key of Object.keys(ledger).sort()) {
    const last = ledger[key].entries.at(-1);
    heads.push(`${key}:${ledger[key].entries.length}:${last ? await entryHash(last) : ""}`);
  }
  return sha256(heads.join("|"));
}
/** 기록 묶음(예: 한 사업의 결산보고서)의 지문. 기록 내용이 그대로면 원장에 줄이 늘어도 같다. */
export async function recordsFingerprint(list: Expense[]): Promise<string> {
  const digests = await Promise.all(list.map(recordDigest));
  return sha256(digests.sort().join("|"));
}
/** 사람이 읽고 견주기 쉬운 짧은 지문. */
export const shortPrint = (hash: string) => (hash.slice(0, 16).toUpperCase().match(/.{4}/g) ?? []).join("-");

export interface Member {
  key: string;
  name: string;
  role: Role;
  entries: number;
  firstAt: string;
  lastAt: string;
}
/** 원장에 서명한 기기 목록. 이름과 역할은 그 기기가 마지막으로 밝힌 값이다. */
export function members(ledger: Ledger): Member[] {
  return Object.entries(ledger)
    .filter(([, c]) => c.entries.length)
    .map(([key, c]) => ({ key, name: c.entries.at(-1)!.name, role: c.entries.at(-1)!.role, entries: c.entries.length, firstAt: c.entries[0].at, lastAt: c.entries.at(-1)!.at }))
    .sort((a, b) => a.firstAt.localeCompare(b.firstAt));
}

export interface Audit {
  /** 지금 내용에 서명한 줄이 있는지 */
  signed: boolean;
  /** 지금 내용에 서명한 기기 */
  signer?: { key: string; name: string; at: string };
  /** 승인된 기록일 때: 승인 서명이 규칙에 맞는지. 승인 전이면 undefined */
  approval?: { ok: boolean; text: string; by?: { key: string; name: string; at: string }; submitter?: { key: string; name: string; at: string } };
}
/**
 * 기록 한 건을 원장과 견준다.
 * 승인은 (1) 승인자 역할을 밝힌 기기가 서명했고 (2) 그 기기가 승인 전 내용을 올린 기기와 달라야 인정한다.
 */
export async function auditRecord(e: Expense, ledger: Ledger, policy: { submitterApproves?: boolean } = {}): Promise<Audit> {
  const digest = await recordDigest(e);
  const all = Object.values(ledger).flatMap((c) => c.entries).filter((x) => x.id === e.id);
  const hit = all.filter((x) => x.digest === digest).sort((a, b) => a.at.localeCompare(b.at));
  const who = (x: Entry) => ({ key: x.key, name: x.name, at: x.at });
  const audit: Audit = { signed: hit.length > 0, signer: hit[0] ? who(hit[0]) : undefined };
  if (!e.approvedBy) return audit;
  const approve = hit.find((x) => x.type === "approve");
  if (!approve) return { ...audit, approval: { ok: false, text: audit.signed ? "승인 서명 없이 승인된 상태로 올라온 기록입니다" : "승인 서명이 없습니다" } };
  const by = who(approve);
  // 단체가 "등록자도 승인"으로 정했으면 등록자 기기의 승인과 직접 올린 지출의 승인을 받아들이되, 그렇다는 것을 글로 남긴다.
  const open = policy.submitterApproves === true;
  if (approve.role !== "approver" && !open) return { ...audit, approval: { ok: false, text: "승인자 역할이 아닌 기기가 승인했습니다", by } };
  const submitted = all.filter((x) => x.type === "record" && x.digest === approve.base);
  if (!submitted.length) return { ...audit, approval: { ok: false, text: "승인한 내용을 올린 서명이 원장에 없습니다", by } };
  if (submitted.every((x) => x.key === approve.key)) {
    if (!open) return { ...audit, approval: { ok: false, text: "올린 기기와 승인한 기기가 같습니다", by } };
    return { ...audit, approval: { ok: true, text: "올린 기기가 직접 승인했습니다", by, submitter: who(submitted[0]) } };
  }
  const text = approve.role === "approver" ? "승인 서명을 확인했습니다" : "등록자 기기가 승인했습니다";
  return { ...audit, approval: { ok: true, text, by, submitter: who(submitted.find((x) => x.key !== approve.key)!) } };
}

export interface LedgerSummary {
  head: string;
  devices: number;
  entries: number;
}
export async function summarize(ledger: Ledger): Promise<LedgerSummary> {
  const chains = Object.values(ledger);
  return { head: await ledgerHead(ledger), devices: chains.filter((c) => c.entries.length).length, entries: chains.reduce((n, c) => n + c.entries.length, 0) };
}

/* ---------- 이 기기에 보관하는 원장과 열쇠 ---------- */
export const LEDGER_KEY = "open-receipt:ledger:v1";
export interface LedgerState {
  me: Identity | null;
  ledger: Ledger;
}
export function loadLedger(kv: { getItem(k: string): string | null }): LedgerState {
  try {
    const d = JSON.parse(kv.getItem(LEDGER_KEY) ?? "null");
    if (!d || typeof d !== "object") return { me: null, ledger: {} };
    return { me: d.me && typeof d.me.key === "string" && d.me.priv ? d.me : null, ledger: d.ledger && typeof d.ledger === "object" ? d.ledger : {} };
  } catch {
    return { me: null, ledger: {} };
  }
}
export function saveLedger(kv: { setItem(k: string, v: string): void }, s: LedgerState): boolean {
  try {
    kv.setItem(LEDGER_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}
