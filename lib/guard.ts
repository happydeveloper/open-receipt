// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 판정 표현 걸러내기.
 *
 * 이 앱은 지출이 규정에 맞는지 판정하지 않는다. AI가 쓴 문장에 "적법", "위반" 같은 말이 들어 있으면
 * 그 문장을 통째로 "확인이 필요합니다."로 바꾼다. 에이전트가 만든 모든 문장이 이 함수를 거친다.
 */
export const FORBIDDEN = /(부적법|적법|위반|불법|규정상\s*불가)/;
export const NEUTRAL = "확인이 필요합니다.";

/** 판정 표현이 든 문장을 중립 문장으로 바꾼다. count는 바꾼 문장 수. 연달아 바뀐 문장은 하나로 줄인다. */
export function softenJudgment(text: string): { text: string; count: number } {
  if (!text) return { text: "", count: 0 };
  let count = 0;
  const parts = text.split(/(?<=[.!?。])\s+|\n+/).map((s) => {
    if (FORBIDDEN.test(s)) {
      count++;
      return NEUTRAL;
    }
    return s;
  });
  const out: string[] = [];
  for (const p of parts) if (!(p === NEUTRAL && out[out.length - 1] === NEUTRAL)) out.push(p);
  return { text: out.join(" ").trim(), count };
}
