// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 정식 출시 알림 대기자 등록. 이메일은 출시 안내에만 쓴다.
 * 비공개 저장소에 이메일별로 한 건씩 저장하고, 같은 이메일은 한 번만 받는다.
 */
import { sha256, type SyncStore } from "./sync-store";

export interface WaitlistEntry {
  email: string;
  org: string;
  /** 어떤 일에 쓰고 싶은지 (선택) */
  use: string;
  consentedAt: string;
}
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function joinWaitlist(store: SyncStore | null, body: any, now = new Date().toISOString()): Promise<Response> {
  if (!store) return json({ error: "지금은 등록을 받을 수 없습니다. 잠시 후 다시 시도해 주세요." }, 503);
  // 사람에게는 보이지 않는 칸이 채워져 있으면 자동 프로그램으로 보고 조용히 넘긴다.
  if (str(body?.website, 200)) return json({ ok: true });
  const email = str(body?.email, 320).toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "이메일 주소를 확인해 주세요. 예: name@example.com" }, 400);
  if (body?.consent !== true) return json({ error: "이메일 수집·이용에 동의해 주세요." }, 400);
  const entry: WaitlistEntry = { email, org: str(body?.org, 80), use: str(body?.use, 200), consentedAt: now };
  // 이미 등록된 이메일도 같은 응답을 준다 (등록 여부를 알려 주지 않는다).
  await store.putNew(`waitlist/${sha256(email)}.json`, JSON.stringify(entry));
  return json({ ok: true });
}

/** 등록 취소. 저장된 이메일을 지운다. 등록되어 있었는지는 알려 주지 않는다. */
export async function leaveWaitlist(store: SyncStore | null, body: any): Promise<Response> {
  if (!store) return json({ error: "지금은 처리할 수 없습니다. 잠시 후 다시 시도해 주세요." }, 503);
  const email = str(body?.email, 320).toLowerCase();
  if (!EMAIL.test(email)) return json({ error: "이메일 주소를 확인해 주세요. 예: name@example.com" }, 400);
  await store.del(`waitlist/${sha256(email)}.json`);
  return json({ ok: true });
}

/** 운영자용: 등록된 대기자 목록. 스크립트에서만 쓴다. */
export async function listWaitlist(store: SyncStore): Promise<WaitlistEntry[]> {
  const out: WaitlistEntry[] = [];
  for (const key of await store.list("waitlist/")) {
    const raw = await store.get(key);
    if (raw) out.push(JSON.parse(raw));
  }
  return out.sort((a, b) => a.consentedAt.localeCompare(b.consentedAt));
}
