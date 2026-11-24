// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 결산보고서 공유. 서버에 저장하지 않고, 보고서 내용을 압축해 링크(#뒤)에 담는다.
 * 링크를 가진 사람만 볼 수 있고, 영수증 이미지는 들어가지 않는다.
 * 기본값은 사람 이름을 가리고, 지출 내역 포함 여부를 고를 수 있다.
 */
import type { Report } from "./report";

export interface ShareOptions {
  /** 지출 내역(건별 행)과 환급 대상을 포함할지 */
  includeRows: boolean;
  /** 결제자 이름과 요약 문장을 그대로 보여 줄지 */
  showNames: boolean;
}
export interface SharedReport {
  v: 1;
  org: string;
  sharedAt: string;
  options: ShareOptions;
  report: Report;
  /** 변조 확인용 지문: 이 사업 기록의 지문과 서명 원장의 지문 */
  proof?: { fingerprint: string; ledger: { head: string; devices: number; entries: number } };
}
export const MASKED = "가림";
/** 이보다 길면 일부 메신저·브라우저에서 링크가 잘릴 수 있다. */
export const LONG_LINK = 8000;

/** 공유 선택에 맞춰 보고서에서 내보내지 않을 부분을 지운다. 지운 뒤의 자료만 링크에 담긴다. */
export function buildShare(report: Report, org: string, options: ShareOptions, sharedAt = new Date().toISOString()): SharedReport {
  const r: Report = {
    ...report,
    rows: options.includeRows ? report.rows.map((x) => ({ ...x, summary: options.showNames ? x.summary : "" })) : [],
    reimbursements: options.includeRows ? report.reimbursements.map((x) => ({ ...x, payer: options.showNames ? x.payer : MASKED })) : [],
    openItems: options.includeRows ? report.openItems : [],
  };
  return { v: 1, org, sharedAt, options, report: r };
}

const toB64Url = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as any));
  return new Uint8Array(await res.arrayBuffer());
}

/** JSON → deflate 압축 → base64url. 주소의 # 뒤에 붙일 문자열이 된다. */
export async function encodeShare(data: SharedReport): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return toB64Url(await pipe(bytes, new CompressionStream("deflate-raw") as any));
}

/** encodeShare의 반대. 깨졌거나 형식이 다르면 null. */
export async function decodeShare(code: string): Promise<SharedReport | null> {
  try {
    const bytes = await pipe(fromB64Url(code.replace(/^#/, "")), new DecompressionStream("deflate-raw") as any);
    const d = JSON.parse(new TextDecoder().decode(bytes));
    const r = d?.report;
    if (d?.v !== 1 || !r || typeof r.project !== "string" || typeof r.total !== "number" || !Array.isArray(r.byCategory) || !Array.isArray(r.rows)) return null;
    return d as SharedReport;
  } catch {
    return null;
  }
}
