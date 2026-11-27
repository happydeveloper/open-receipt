// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 예산 항목. 단체가 쓰는 항목 목록을 하나로 두고, 사람이 고를 때도 에이전트가 채울 때도 이 목록에서 끌어다 쓴다.
 *
 * 목록이 없으면 에이전트가 영수증마다 "식사", "식비", "다과비"처럼 제각각 이름을 지어, 결산보고서의
 * 예산 항목별 집행이 잘게 흩어진다. 그래서 작은 단체가 흔히 쓰는 항목을 기본으로 깔아 두고,
 * 에이전트가 낸 이름은 목록의 항목으로 맞춘다. 단체는 설정에서 항목을 더하거나 뺄 수 있다.
 */
export const DEFAULT_CATEGORIES = ["회의·행사비", "식비·다과비", "여비·교통비", "숙박비", "강사비·사례비", "홍보·인쇄비", "물품·재료비", "대관·임차료", "사무·운영비", "기타"] as const;
export const CATEGORY_MAX = 40;
export const OTHER = "기타";

const clean = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 60) : "");
/** 무엇이 들어오든 항목 목록으로 다듬는다. 정한 적이 없으면(undefined, 빈 배열 아님) 기본 항목을 쓴다. */
export function normalizeCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CATEGORIES];
  return [...new Set(raw.map(clean).filter(Boolean))].slice(0, CATEGORY_MAX);
}
/** 항목을 더한다. 이미 있으면 그대로다. */
export const addCategory = (list: string[], name: string): string[] => normalizeCategories([...list, name]);
export const removeCategory = (list: string[], name: string): string[] => list.filter((c) => c !== name);
/** 화면과 에이전트에 보일 목록: 단체가 정한 항목에, 이미 기록이나 예산에 쓰인 항목을 더한 것. */
export function categoryChoices(list: string[], used: Iterable<string> = []): string[] {
  return [...new Set([...list, ...[...used].map(clean).filter(Boolean)])].slice(0, CATEGORY_MAX + 20);
}

// 낱말 → 기본 항목. 에이전트가 목록에 없는 이름을 냈을 때, 뜻이 같은 항목을 찾는 데 쓴다.
const HINTS: [RegExp, string][] = [
  [/식사|식비|식대|다과|간식|음료|도시락|커피|급식|밥|회식/, "식비·다과비"],
  [/교통|여비|주유|유류|택시|버스|기차|ktx|항공|주차|통행|톨게이트|운임|출장/i, "여비·교통비"],
  [/숙박|호텔|모텔|펜션|숙소|게스트하우스/, "숙박비"],
  [/강사|사례|강의료|강연|자문|원고|심사|수당|인건/, "강사비·사례비"],
  [/홍보|인쇄|현수막|배너|포스터|리플렛|전단|디자인|출력|광고|명함|제본/, "홍보·인쇄비"],
  [/대관|임차|임대|렌트|렌탈|대여|장소/, "대관·임차료"],
  [/물품|재료|소모품|비품|문구|용품|기자재|구입|도서|교재/, "물품·재료비"],
  [/사무|운영|통신|우편|택배|수수료|공과금|보험|관리/, "사무·운영비"],
  [/회의|행사|세미나|워크숍|워크샵|교육|연수|캠프|발표회|모임|진행/, "회의·행사비"],
];
const key = (s: string) => s.replace(/[\s·.,/()\-_]|비$|료$/g, "").toLowerCase();

/**
 * 에이전트가 낸 예산 항목 이름을 목록의 항목으로 맞춘다.
 *  1. 목록에 그대로 있으면 그것.
 *  2. 띄어쓰기·가운뎃점·끝의 "비"만 다르면 그 항목 ("교통비" → "여비·교통비"처럼 한쪽이 다른 쪽을 품는 경우 포함).
 *  3. 뜻이 같은 기본 항목이 목록에 있으면 그것 ("식사" → "식비·다과비").
 *  4. 그래도 없으면 "기타"(목록에 있을 때). 목록이 비어 있거나 "기타"가 없으면 낸 이름을 그대로 둔다.
 */
export function matchCategory(value: unknown, list: string[]): string {
  const v = clean(value);
  if (!v || !list.length) return v;
  if (list.includes(v)) return v;
  const k = key(v);
  const same = list.find((c) => key(c) === k);
  if (same) return same;
  if (k.length >= 2) {
    // "여비·교통비"의 한 토막("교통비")이거나, 항목 이름을 품은 더 긴 이름("행사 홍보·인쇄비")
    const part = list.find((c) => c !== OTHER && (c.split(/[·/,]/).some((p) => key(p) === k) || k.includes(key(c))));
    if (part) return part;
  }
  for (const [re, name] of HINTS) if (re.test(v) && list.includes(name)) return name;
  return list.includes(OTHER) ? OTHER : v;
}
