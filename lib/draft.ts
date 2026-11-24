// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 모델이나 사람이 준 값을 저장할 수 있는 형태로 다듬는 도우미.
 */
/** 금액 표기("26,400원", 26400.4)를 원 단위 정수로 바꾼다. 쓸 수 없으면 null. */
export function normalizeAmount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === "string") {
    const digits = v.replace(/[^\d]/g, "");
    if (digits) {
      const n = Number(digits);
      if (n > 0) return n;
    }
  }
  return null;
}
