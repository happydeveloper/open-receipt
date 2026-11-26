// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 사업 마감. 결산이 끝난 사업을 잠가, 그 사업의 기록을 더 올리거나 고치거나 지우지 못하게 한다.
 *
 * - 마감하고 푸는 것은 승인할 수 있는 사람이 한다 (혼자 쓰는 기기는 그 사람, 단체 공간은 승인자, "등록자도 승인"이면 누구나).
 * - 마감은 사업 이름마다 "누가 언제 마감했다 / 풀었다"로 남기고, 단체 공간에서는 모든 기기에 전해진다.
 * - 로그인이 없으므로 화면 수준의 잠금이다. 마감을 모르는 기기(아직 맞추지 않은 기기)가 고친 것은 들어올 수 있고,
 *   그런 기록은 changedAfterClose로 찾아 "마감 뒤에 바뀐 기록"으로 드러낸다.
 */
import type { Actor, ApprovalPolicy } from "./status";
import type { Expense } from "./types";

export interface Closing {
  /** 마감했거나 푼 시각 */
  at: string;
  /** 한 사람 */
  by: string;
  /** true면 마감을 푼 것이다. 지우지 않고 남겨 두어야 다른 기기의 예전 "마감"을 이긴다 */
  open?: boolean;
}
/** 사업 이름 → 마지막 마감 기록 */
export type Closings = Record<string, Closing>;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/** 무엇이 들어오든 마감 기록 모양으로 다듬는다. */
export function normalizeClosings(raw: unknown): Closings {
  const out: Closings = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [project, v] of Object.entries(raw as object).slice(0, 60)) {
    const c = v as any;
    const at = str(c?.at, 40);
    if (!project.trim() || !at || Number.isNaN(Date.parse(at))) continue;
    out[project.trim().slice(0, 60)] = { at, by: str(c?.by, 30), ...(c?.open === true ? { open: true } : {}) };
  }
  return out;
}
/** 지금 마감된 사업인지. */
export const isClosed = (c: Closings | undefined, project: string): boolean => !!project && !!c?.[project] && !c[project].open;
export const closingOf = (c: Closings | undefined, project: string): Closing | null => (isClosed(c, project) ? c![project] : null);

/** 마감하거나 풀 수 없는 이유. 할 수 있으면 null. 승인과 같은 사람이 한다. */
export function closeBlock(who: Actor, policy: ApprovalPolicy = {}): string | null {
  if (!who.shared || policy.submitterApproves || who.role === "approver") return null;
  return "마감은 승인자가 합니다";
}
export function closeProject(c: Closings, project: string, by: string, at = new Date().toISOString()): Closings {
  return { ...c, [project]: { at, by } };
}
export function reopenProject(c: Closings, project: string, by: string, at = new Date().toISOString()): Closings {
  return { ...c, [project]: { at, by, open: true } };
}
/** 두 기기의 마감 기록을 합친다. 사업마다 나중에 한 쪽이 남는다. */
export function mergeClosings(a: Closings | undefined, b: Closings | undefined): Closings {
  const out: Closings = { ...(a ?? {}) };
  for (const [p, c] of Object.entries(b ?? {})) {
    if (!out[p] || (Date.parse(c.at) || 0) > (Date.parse(out[p].at) || 0)) out[p] = c;
  }
  return out;
}

/** 사진처럼 크기만 다시 맞춘 것은 내용이 바뀐 것으로 보지 않는다. */
const body = (e: Expense): string => {
  const { evidence, updatedAt: _u, fieldAt: _f, ...rest } = e as any;
  return JSON.stringify({ ...rest, kind: evidence?.kind, docs: [evidence?.image ? 1 : 0, ...(evidence?.extra ?? []).map((x: any) => x.id)] });
};
export interface Guarded {
  /** 마감된 사업을 건드린 변경을 되돌린 목록 */
  list: Expense[];
  /** 되돌린 변경의 수 */
  blocked: number;
  /** 막힌 사업 이름들 */
  projects: string[];
}
/**
 * 이 기기에서 한 변경 가운데 마감된 사업을 건드리는 것을 되돌린다.
 * 마감된 사업의 기록을 고치기, 지우기, 새로 올리기, 다른 사업에서 옮겨 넣기, 다른 사업으로 빼기가 모두 막힌다.
 */
export function guardClosed(prev: Expense[], next: Expense[], c: Closings | undefined): Guarded {
  if (!c || !Object.values(c).some((x) => !x.open)) return { list: next, blocked: 0, projects: [] };
  const before = new Map(prev.map((e) => [e.id, e]));
  const after = new Set(next.map((e) => e.id));
  const projects = new Set<string>();
  let blocked = 0;
  const list: Expense[] = [];
  for (const e of next) {
    const old = before.get(e.id);
    if (!old) {
      if (isClosed(c, e.project)) { blocked++; projects.add(e.project); continue; } // 새로 올리기
      list.push(e);
      continue;
    }
    const touched = isClosed(c, old.project) ? old.project : isClosed(c, e.project) ? e.project : "";
    if (touched && body(old) !== body(e)) { blocked++; projects.add(touched); list.push(old); continue; }
    list.push(e);
  }
  // 지운 기록 되살리기
  for (const old of prev) {
    if (!after.has(old.id) && isClosed(c, old.project)) { blocked++; projects.add(old.project); list.push(old); }
  }
  return { list, blocked, projects: [...projects] };
}
/** 마감한 뒤에 바뀐 기록. 마감을 모르던 다른 기기가 고친 것이 들어온 경우다. */
export function changedAfterClose(list: Expense[], c: Closings | undefined, project: string): Expense[] {
  const closing = closingOf(c, project);
  if (!closing) return [];
  const t = Date.parse(closing.at) || 0;
  return list.filter((e) => e.project === project && (Date.parse(e.updatedAt ?? "") || 0) > t);
}
/** 마감 전에 알려 줄 것: 아직 끝나지 않은 기록 수. 막지는 않는다. */
export function unfinished(list: Expense[], project: string): number {
  return list.filter((e) => e.project === project && e.status !== "done").length;
}
