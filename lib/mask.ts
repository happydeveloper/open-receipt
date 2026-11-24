// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 민감 정보 가림.
 *
 * - 글: 메모에 든 주민번호·카드번호·전화번호 패턴을 서버로 보내기 전에 가린다(maskText).
 * - 사진: 사용자가 그린 상자 영역을 검게 덮는다(fillBoxes). 캔버스에 그리는 일은 화면
 *   (app/app/page.tsx의 makeMaskedImage)이 하고, 여기에는 테스트할 수 있는 계산만 둔다.
 */
// 주민번호, 카드번호, 휴대폰 번호. 사이에 공백이나 하이픈이 있어도 잡는다.
const RRN = /\b\d{6}[- ]?[1-4]\d{6}\b/g;
const CARD = /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{3,4}\b/g;
const PHONE = /\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g;

export function maskText(text: string): string {
  return text
    .replace(RRN, "[주민번호 가림]")
    .replace(CARD, "[카드번호 가림]")
    .replace(PHONE, "[전화번호 가림]");
}

export interface Box {
  /** 0~1 사이 비율 좌표 */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 긴 변이 max를 넘지 않게 줄인 크기. 올리는 사진의 용량을 줄이는 데 쓴다. */
export function fitWithin(w: number, h: number, max = 1600): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** RGBA 픽셀 배열에서 가림 상자 영역을 검은색으로 덮는다. */
export function fillBoxes(data: Uint8ClampedArray, w: number, h: number, boxes: Box[]): void {
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x * w));
    const y0 = Math.max(0, Math.floor(b.y * h));
    const x1 = Math.min(w, Math.ceil((b.x + b.w) * w));
    const y1 = Math.min(h, Math.ceil((b.y + b.h) * h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }
}
