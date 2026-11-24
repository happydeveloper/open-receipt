// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 기기 설정(단체 이름, 내 이름과 역할, 사업 목록)과 백업 파일.
 * 설정은 브라우저의 localStorage에 둔다. 읽을 때 항상 normalizeSettings로 다듬어 깨진 값을 걸러 낸다.
 */
import type { KV } from "./storage";

export const SETTINGS_KEY = "open-receipt:settings:v1";
export interface Settings {
  /** 단체 이름 */
  org: string;
  /** 기록을 올리는 사람 (총무·재정 담당) */
  submitter: string;
  /** 승인하는 사람 (대표) */
  approver: string;
  /** 사업·행사 이름 목록 */
  projects: string[];
  /** 지원기관 (선택). 에이전트가 지침을 찾을 때 참고한다. */
  funder: string;
  /** 첫 방문 소개를 마쳤는지 */
  onboarded: boolean;
  /** 이 기기를 쓰는 사람의 역할. 승인자 기기에서는 "내 이름"으로 승인을 기록한다. */
  role: "submitter" | "approver";
  /** 후원자용 보기 링크를 켰는지 (단체 공간에서 함께 쓰는 설정) */
  sponsorView: boolean;
  /** 후원자용 보기에서 사람 이름을 보여 줄지 */
  sponsorNames: boolean;
}
export const EMPTY_SETTINGS: Settings = { org: "", submitter: "", approver: "", projects: [], funder: "", onboarded: false, role: "submitter", sponsorView: false, sponsorNames: false };
export const DEMO_SETTINGS: Settings = { org: "다온 나눔모임 (가상)", submitter: "김○○", approver: "박○○", projects: ["자원봉사자 워크숍"], funder: "", onboarded: true, role: "submitter", sponsorView: false, sponsorNames: false };

const str = (v: unknown, max = 60) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 무엇이 들어오든 Settings 모양으로 다듬는다. 길이를 자르고, 모르는 값은 기본값으로 바꾼다. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const projects = Array.isArray(r.projects) ? [...new Set(r.projects.map((p: unknown) => str(p)).filter(Boolean))].slice(0, 30) : [];
  return { org: str(r.org), submitter: str(r.submitter, 30), approver: str(r.approver, 30), projects: projects as string[], funder: str(r.funder), onboarded: r.onboarded === true, role: r.role === "approver" ? "approver" : "submitter", sponsorView: r.sponsorView === true, sponsorNames: r.sponsorNames === true };
}
export function loadSettings(kv: KV): Settings {
  try {
    const raw = kv.getItem(SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...EMPTY_SETTINGS };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}
export function saveSettings(kv: KV, s: Settings): boolean {
  try {
    kv.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(s)));
    return true;
  } catch {
    return false;
  }
}
/** 시작에 필요한 값이 빠졌으면 무엇이 빠졌는지 돌려준다. */
export function missingForStart(s: Settings): string[] {
  const out: string[] = [];
  if (!s.org) out.push("단체 이름");
  if (!s.submitter) out.push("내 이름");
  if (!s.projects.length) out.push("첫 사업·행사 이름");
  return out;
}
export function addProject(s: Settings, name: string): Settings {
  const n = str(name);
  return n && !s.projects.includes(n) ? { ...s, projects: [...s.projects, n] } : s;
}

/* ---------- 백업 ---------- */
export const BACKUP_KIND = "open-receipt-backup";
export function makeBackup(settings: Settings, expenses: unknown[], at = new Date().toISOString()): string {
  return JSON.stringify({ kind: BACKUP_KIND, version: 1, exportedAt: at, settings, expenses }, null, 2);
}
/** 백업 파일을 읽는다. 이 앱의 백업이 아니면 null. 모양이 깨진 기록은 뺀다. */
export function parseBackup(text: string): { settings: Settings; expenses: any[] } | null {
  try {
    const d = JSON.parse(text);
    if (d?.kind !== BACKUP_KIND || !Array.isArray(d.expenses)) return null;
    const expenses = d.expenses.filter((e: any) => e && typeof e === "object" && typeof e.id === "string" && e.evidence && typeof e.evidence === "object");
    return { settings: { ...normalizeSettings(d.settings), onboarded: true }, expenses };
  } catch {
    return null;
  }
}
