// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 모델이나 사람이 준 값을 저장할 수 있는 형태로 다듬는 도우미.
 */
/**
 * 금액 표기("26,400원", 26400.4)를 원 단위 정수로 바꾼다. 쓸 수 없으면 null.
 * refund를 켜면 음수(환불, 되돌려 받은 돈)도 받는다. 0은 금액으로 치지 않는다.
 * 환불은 사람만 넣을 수 있다. 모델이 준 값은 양수만 받는다.
 */
export function normalizeAmount(v: unknown, refund = false): number | null {
  const ok = (n: number) => (refund ? n !== 0 : n > 0);
  if (typeof v === "number" && Number.isFinite(v) && ok(Math.round(v))) return Math.round(v);
  if (typeof v === "string") {
    const digits = v.replace(/[^\d]/g, "");
    if (digits) {
      const n = Number(digits) * (refund && /^\s*[-−]/.test(v) ? -1 : 1);
      if (ok(n)) return n;
    }
  }
  return null;
}
