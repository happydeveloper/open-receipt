// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 기기 설정(단체 이름, 내 이름과 역할, 사업 목록)과 백업 파일.
 * 설정은 브라우저의 localStorage에 둔다. 읽을 때 항상 normalizeSettings로 다듬어 깨진 값을 걸러 낸다.
 */
import { DEFAULT_CATEGORIES, normalizeCategories } from "./categories";
import { normalizeClosings, type Closings } from "./closing";
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
  /** 등록자도 승인할 수 있게 할지 (단체 공간에서 함께 쓰는 설정). 끄면 승인자 역할만 승인한다 */
  submitterApproves: boolean;
  /** 예산: 사업 이름 → 예산 항목 → 배정한 금액(원). 결산보고서에서 쓴 돈과 견준다 (단체 공간에서 함께 쓰는 설정) */
  budgets: Budgets;
  /** 마감한 사업: 사업 이름 → 누가 언제 마감했는지 (단체 공간에서 함께 쓰는 설정). lib/closing.ts */
  closed: Closings;
  /** 단체가 쓰는 예산 항목 목록 (단체 공간에서 함께 쓰는 설정). 정한 적이 없으면 기본 항목. lib/categories.ts */
  categories: string[];
}
export type Budgets = Record<string, Record<string, number>>;
/** 무엇이 들어오든 예산 모양으로 다듬는다. 0 이하나 숫자가 아닌 값은 뺀다. */
export function normalizeBudgets(raw: unknown): Budgets {
  const out: Budgets = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [project, cats] of Object.entries(raw as object).slice(0, 30)) {
    if (!cats || typeof cats !== "object") continue;
    const row: Record<string, number> = {};
    for (const [cat, v] of Object.entries(cats as object).slice(0, 40)) {
      const n = Math.round(Number(v));
      if (cat.trim() && Number.isFinite(n) && n > 0) row[cat.trim().slice(0, 60)] = n;
    }
    if (Object.keys(row).length) out[project.trim().slice(0, 60)] = row;
  }
  return out;
}
/** 한 사업의 한 예산 항목에 금액을 정한다. 0이나 빈 값이면 그 항목의 예산을 지운다. */
export function setBudget(s: Settings, project: string, category: string, amount: number | null): Settings {
  const row = { ...(s.budgets[project] ?? {}) };
  if (amount && amount > 0) row[category] = Math.round(amount);
  else delete row[category];
  return { ...s, budgets: normalizeBudgets({ ...s.budgets, [project]: row }) };
}
export const EMPTY_SETTINGS: Settings = { org: "", submitter: "", approver: "", projects: [], funder: "", onboarded: false, role: "submitter", sponsorView: false, sponsorNames: false, submitterApproves: false, budgets: {}, closed: {}, categories: [...DEFAULT_CATEGORIES] };
export const DEMO_SETTINGS: Settings = { org: "다온 나눔모임 (가상)", submitter: "김○○", approver: "박○○", projects: ["자원봉사자 워크숍"], funder: "", onboarded: true, role: "submitter", sponsorView: false, sponsorNames: false, submitterApproves: false, budgets: {}, closed: {}, categories: [...DEFAULT_CATEGORIES] };

const str = (v: unknown, max = 60) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** 무엇이 들어오든 Settings 모양으로 다듬는다. 길이를 자르고, 모르는 값은 기본값으로 바꾼다. */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as any;
  const projects = Array.isArray(r.projects) ? [...new Set(r.projects.map((p: unknown) => str(p)).filter(Boolean))].slice(0, 30) : [];
  return { org: str(r.org), submitter: str(r.submitter, 30), approver: str(r.approver, 30), projects: projects as string[], funder: str(r.funder), onboarded: r.onboarded === true, role: r.role === "approver" ? "approver" : "submitter", sponsorView: r.sponsorView === true, sponsorNames: r.sponsorNames === true, submitterApproves: r.submitterApproves === true, budgets: normalizeBudgets(r.budgets), closed: normalizeClosings(r.closed), categories: normalizeCategories(r.categories) };
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
/**
 * 백업 파일을 만든다. originals에는 원본 사진(사진 이름 → 사진)을 준다.
 * 원본은 기록 목록과 따로 보관되어 있어, 예전 백업에는 들어가지 않았다. 그래서 새 기기로 옮기면 원본이 사라졌다.
 */
export function makeBackup(settings: Settings, expenses: unknown[], at = new Date().toISOString(), originals: Record<string, string> = {}): string {
  return JSON.stringify({ kind: BACKUP_KIND, version: 2, exportedAt: at, settings, expenses, originals }, null, 2);
}
/** 백업 파일을 읽는다. 이 앱의 백업이 아니면 null. 모양이 깨진 기록은 뺀다. 원본이 없는 예전 백업도 읽는다. */
export function parseBackup(text: string): { settings: Settings; expenses: any[]; originals: Record<string, string> } | null {
  try {
    const d = JSON.parse(text);
    if (d?.kind !== BACKUP_KIND || !Array.isArray(d.expenses)) return null;
    const expenses = d.expenses.filter((e: any) => e && typeof e === "object" && typeof e.id === "string" && e.evidence && typeof e.evidence === "object");
    const originals: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.originals && typeof d.originals === "object" ? d.originals : {})) if (typeof v === "string" && v.startsWith("data:image/")) originals[k] = v;
    return { settings: { ...normalizeSettings(d.settings), onboarded: true }, expenses, originals };
  } catch {
    return null;
  }
}

/* ---------- 백업 안내 ---------- */
export const BACKUP_KEY = "open-receipt:backup:v1";
export const BACKUP_FIRST_AT = 10; // 기록이 이만큼 쌓였는데 백업한 적이 없으면 알린다
export const BACKUP_EVERY_DAYS = 14;
/**
 * 백업을 권할 때가 됐으면 안내 문장을, 아니면 빈 문자열을 돌려준다.
 * 기록은 이 기기의 브라우저에만 있어서, 사이트 자료를 지우거나 기기를 잃으면 함께 사라진다.
 */
export function backupAdvice(records: { updatedAt?: string }[], lastBackupAt: string, now: string = new Date().toISOString()): string {
  if (!records.length) return "";
  if (!lastBackupAt) return records.length >= BACKUP_FIRST_AT ? `기록이 ${records.length}건 쌓였는데 아직 백업한 적이 없습니다. 기록은 이 기기에만 있어, 기기를 잃거나 브라우저 자료를 지우면 사라집니다.` : "";
  const days = Math.floor((Date.parse(now) - Date.parse(lastBackupAt)) / (24 * 60 * 60_000));
  const changed = records.filter((e) => (e.updatedAt ?? "") > lastBackupAt).length;
  return days >= BACKUP_EVERY_DAYS && changed > 0 ? `마지막 백업이 ${days}일 전입니다. 그 뒤로 ${changed}건이 바뀌었습니다.` : "";
}
