// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 한 지출에 붙은 사진들을 다루는 도구.
 *
 * 지출 한 건에는 사진이 여러 장 붙을 수 있다. 영수증(evidence.image) 한 장과,
 * 거래명세서·주문내역처럼 함께 묶는 자료(evidence.extra) 여러 장이다.
 * 사진은 기록 목록과 따로 저장하고 따로 올리므로, 사진마다 이름(key)이 필요하다.
 *
 * - 영수증의 이름은 기록 id 그대로다 (예전 저장분과 같다).
 * - 함께 묶은 자료의 이름은 "기록 id-x-자료 id"다.
 *
 * 저장(lib/storage.ts), 동기화(lib/sync-merge.ts, lib/sync-client.ts), 후원자용 보기(lib/sponsor-view.ts),
 * 결산보고서(lib/report.ts)가 모두 이 파일의 함수로 사진을 찾는다.
 */
import type { Attachment, Expense } from "./types";

/** 함께 묶는 자료의 종류. 화면의 선택 목록에 쓴다. */
export const ATTACH_LABELS = ["거래명세서", "주문내역", "카드전표", "이체확인증", "견적서", "기타"];

/** 진짜 사진인지. 자리표시("local:image", "sync:image", 1x1 그림)는 짧아서 길이로 구분한다. */
export const isPhoto = (v?: string): v is string => !!v && v.length > 200;
/** 사진이 있는 자리인지. 이 기기가 아직 받지 못한 사진(자리표시)도 있는 것으로 센다. */
export const hasPhoto = (v?: string) => isPhoto(v) || v === "local:image" || v === "sync:image";

/**
 * 사진 한 장(data URI)의 길이 한도. 서버는 암호화한 사진을 200만 자까지 받는데, 암호화하면 1.33배가 되므로
 * 그보다 여유를 두고 잡았다. JPEG로는 1MB쯤이다. 화면이 사진을 만들 때 이 길이에 맞춰 줄인다.
 */
export const MAX_PHOTO_CHARS = 1_400_000;

export const photoKey = (expenseId: string, attachmentId?: string) => (attachmentId ? `${expenseId}-x-${attachmentId}` : expenseId);
export const newAttachmentId = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");

export interface PhotoSlot {
  key: string;
  /** 사진 종류: 영수증, 거래명세서 … */
  label: string;
  /** 사진 또는 자리표시. 없으면 undefined */
  image?: string;
  /** 원본(가리지 않은 사진)이 따로 보관되어 있는지 */
  original: boolean;
  /** 영수증 자리면 true, 함께 묶은 자료면 false */
  main: boolean;
}

/** 영수증 자리의 이름표. 대체 증빙이면 그 종류를 쓴다. */
const mainLabel = (e: Expense) => (e.evidence.kind === "alternative" ? e.evidence.altType || "대체 증빙" : e.evidence.docType || "영수증");

/** 이 지출의 사진 자리 전부 (영수증 먼저, 그다음 함께 묶은 자료 순서). 비어 있는 영수증 자리는 뺀다. */
export function slotsOf(e: Expense): PhotoSlot[] {
  const out: PhotoSlot[] = [];
  if (e.evidence.image) out.push({ key: e.id, label: mainLabel(e), image: e.evidence.image, original: e.evidence.original === true, main: true });
  for (const a of e.evidence.extra ?? []) out.push({ key: photoKey(e.id, a.id), label: a.label, image: a.image, original: a.original === true, main: false });
  return out;
}
/** 이 기기가 실제로 가진 사진만. */
export const photosOf = (e: Expense) => slotsOf(e).filter((s): s is PhotoSlot & { image: string } => isPhoto(s.image));

/** 사진 자리마다 fn을 적용한 기록. 바뀐 것이 없으면 받은 기록을 그대로 돌려준다. */
export function mapPhotos(e: Expense, fn: (image: string | undefined, key: string) => string | undefined): Expense {
  const main = fn(e.evidence.image, e.id);
  const before = e.evidence.extra;
  const extra = before?.map((a) => ({ ...a, image: fn(a.image, photoKey(e.id, a.id)) }));
  const extraChanged = !!extra && extra.some((a, i) => a.image !== before![i].image);
  if (main === e.evidence.image && !extraChanged) return e;
  const evidence = { ...e.evidence };
  if (main !== e.evidence.image) evidence.image = main;
  if (extraChanged) evidence.extra = extra as Attachment[];
  return { ...e, evidence };
}
