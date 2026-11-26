// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 단체 공간 암호화. 기록은 기기에서 AES-GCM으로 암호화한 뒤 서버에 올린다.
 * 열쇠는 초대 링크에만 들어 있고 서버로 보내지 않으므로, 서버는 내용을 읽을 수 없다.
 */
const b64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64 = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export interface Workspace {
  /** 서버가 아는 식별자 */
  id: string;
  /** 암호화 열쇠. 서버로 보내지 않는다. */
  key: string;
  /**
   * 암호로 잠근 공간에만 있다. 초대 링크에 들어가는 값이고, 열쇠는 이 값과 암호로 만든다.
   * 그래서 링크만으로는 열 수 없다. 참여 전(암호를 아직 넣지 않았을 때)에는 key가 비어 있다.
   */
  link?: string;
}
export const ID_PATTERN = /^[A-Za-z0-9_-]{20,40}$/;

export function newWorkspace(): Workspace {
  return { id: b64(crypto.getRandomValues(new Uint8Array(16))), key: b64(crypto.getRandomValues(new Uint8Array(32))) };
}
/* ---------- 암호로 잠근 공간 ---------- */
export const PASSWORD_MIN = 6;
/** 암호가 쓸 만한지. 문제가 있으면 안내 문구를, 괜찮으면 빈 글을 돌려준다. */
export function passwordProblem(password: string): string {
  const p = password.trim();
  if (p.length < PASSWORD_MIN) return `암호는 ${PASSWORD_MIN}자 이상으로 정해 주세요.`;
  if (/^(.)\1+$/.test(p) || /^(0123456789|1234567890|123456789|12345678|1234567|123456)$/.test(p)) return "너무 쉬운 암호입니다. 다른 암호를 정해 주세요.";
  return "";
}
const LOCK_ROUNDS = 310_000;
/**
 * 링크 값과 암호로 열쇠를 만든다 (PBKDF2). 일부러 느리게 만들어, 링크를 손에 넣은 사람이 암호를 하나씩 넣어 보기 어렵게 한다.
 * 암호는 기기 밖으로 나가지 않는다.
 */
export async function lockedKey(id: string, link: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(password.trim().normalize("NFKC")) as BufferSource, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`open-receipt-lock:${id}.${link}`) as BufferSource, iterations: LOCK_ROUNDS }, base, 256);
  return b64(new Uint8Array(bits));
}
/** 암호로 잠근 새 공간. */
export async function newLockedWorkspace(password: string): Promise<Workspace> {
  const { id, key: link } = newWorkspace();
  return { id, key: await lockedKey(id, link, password), link };
}
/** 초대 링크로 들어온 사람이 넣은 암호로 공간을 연다. 암호가 맞는지는 서버의 기록을 풀어 봐야 안다. */
export async function unlockInvite(invite: Workspace, password: string): Promise<Workspace> {
  if (!invite.link) return invite;
  return { id: invite.id, key: await lockedKey(invite.id, invite.link, password), link: invite.link };
}
export const isLocked = (ws: Workspace | null | undefined) => !!ws?.link;

/** 초대 링크의 # 뒤 부분. 잠근 공간의 링크에는 열쇠가 아니라 링크 값만 들어간다. */
export const inviteCode = (ws: Workspace) => (ws.link ? `join=p.${ws.id}.${ws.link}` : `join=${ws.id}.${ws.key}`);
export function parseInvite(hash: string): Workspace | null {
  const m = hash.replace(/^#/, "").match(/^join=(p\.)?([A-Za-z0-9_-]{20,40})\.([A-Za-z0-9_-]{40,50})$/);
  if (!m) return null;
  return m[1] ? { id: m[2], key: "", link: m[3] } : { id: m[2], key: m[3] };
}

async function aesKey(ws: Workspace): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", unb64(ws.key) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptText(ws: Workspace, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(ws), new TextEncoder().encode(text)));
  const out = new Uint8Array(iv.length + data.length);
  out.set(iv);
  out.set(data, iv.length);
  return b64(out);
}
/** 열쇠가 다르거나 내용이 바뀌었으면 null. */
export async function decryptText(ws: Workspace, payload: string): Promise<string | null> {
  try {
    const bytes = unb64(payload);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) as BufferSource }, await aesKey(ws), bytes.subarray(12) as BufferSource);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
/* ---------- 압축 ---------- */
async function through(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const PACKED = "z1:";
/**
 * 글을 압축한다 (deflate). 기록 문서는 같은 낱말이 되풀이되는 JSON이라 몇 분의 일로 줄어든다.
 * 서버가 한 번에 받는 크기가 정해져 있어, 줄인 만큼 더 많은 기록을 담을 수 있다. 암호화하기 전에 한다.
 */
export async function packText(text: string): Promise<string> {
  return PACKED + b64(await through(new TextEncoder().encode(text), new CompressionStream("deflate-raw") as any));
}
/** packText의 반대. 압축하지 않은 예전 글은 그대로 돌려준다. */
export async function unpackText(text: string): Promise<string> {
  if (!text.startsWith(PACKED)) return text;
  return new TextDecoder().decode(await through(unb64(text.slice(PACKED.length)), new DecompressionStream("deflate-raw") as any));
}

/** 쓰기 권한 증표. 열쇠에서 만들며, 서버는 이것의 해시만 보관해 열쇠를 가진 사람만 쓸 수 있게 한다. */
export async function writeToken(ws: Workspace): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`open-receipt-write:${ws.key}`));
  return b64(new Uint8Array(digest));
}

/**
 * 후원자용 보기 열쇠. 구성원 열쇠에서 한 방향으로 만든다.
 * 구성원은 이 열쇠를 만들 수 있지만, 이 열쇠로는 구성원 열쇠를 되찾을 수 없다.
 * 그래서 후원자는 후원자용 자료만 열 수 있고, 원본과 기록 수정에는 접근하지 못한다.
 */
export async function viewerWorkspace(ws: Workspace): Promise<Workspace> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`open-receipt-viewer:${ws.key}`));
  return { id: ws.id, key: b64(new Uint8Array(digest)) };
}
export const viewCode = (viewer: Workspace) => `${viewer.id}.${viewer.key}`;
export function parseViewCode(hash: string): Workspace | null {
  const m = hash.replace(/^#/, "").match(/^([A-Za-z0-9_-]{20,40})\.([A-Za-z0-9_-]{40,50})$/);
  return m ? { id: m[1], key: m[2] } : null;
}
