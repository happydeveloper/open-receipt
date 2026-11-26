// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 화면에서 잡은 오류를 오류 수집 도구로 넘기는 연결 고리.
 * 수집 도구가 붙어 있으면(브라우저 시작 때 등록) 넘기고, 없으면 아무 일도 하지 않는다.
 * 그래서 화면 코드는 어떤 수집 도구를 쓰는지 몰라도 된다.
 */
type Reporter = (error: unknown, where: string) => void;
const KEY = "__openReceiptReport";

export function setReporter(fn: Reporter): void {
  (globalThis as any)[KEY] = fn;
}
/** 오류 수집 도구가 붙어 있는지. 화면이 "기록됩니다"라고 말해도 되는지 정할 때 쓴다. */
export const hasReporter = (): boolean => typeof (globalThis as any)[KEY] === "function";
export function reportError(error: unknown, where: string): void {
  try {
    ((globalThis as any)[KEY] as Reporter | undefined)?.(error, where);
  } catch {
    /* 보고하다 난 오류로 화면을 또 깨뜨리지 않는다 */
  }
}
