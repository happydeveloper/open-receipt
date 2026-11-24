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
}
export const ID_PATTERN = /^[A-Za-z0-9_-]{20,40}$/;

export function newWorkspace(): Workspace {
  return { id: b64(crypto.getRandomValues(new Uint8Array(16))), key: b64(crypto.getRandomValues(new Uint8Array(32))) };
}
/** 초대 링크의 # 뒤 부분. */
export const inviteCode = (ws: Workspace) => `join=${ws.id}.${ws.key}`;
export function parseInvite(hash: string): Workspace | null {
  const m = hash.replace(/^#/, "").match(/^join=([A-Za-z0-9_-]{20,40})\.([A-Za-z0-9_-]{40,50})$/);
  return m ? { id: m[1], key: m[2] } : null;
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
