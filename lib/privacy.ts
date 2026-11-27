// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 모델(Liner)로 보내는 글에서 개인정보를 지우고, 돌아온 답에서 되돌린다.
 *
 * 모델이 일을 하려면 "누가 결제했다"는 사실은 알아야 하지만, 그 사람의 이름을 알 필요는 없다.
 * 그래서 보내기 직전에 사람 이름과 번호를 [사람1], [번호1] 같은 자리표로 바꾸고,
 * 모델이 그 자리표를 써서 답하면(예: 결제자를 "[사람1]"로 채움) 받은 뒤에 원래 값으로 되돌린다.
 * 기록에는 원래 이름이 그대로 남고, 모델 쪽에는 자리표만 간다.
 *
 * 지우는 것:
 *  - 사람 이름: 기록의 결제자·제출자·승인자처럼 이름인 줄 아는 값과, 글에서 "○○○ 님/씨/간사" 꼴로 나온 이름
 *  - 주민등록번호, 카드번호, 전화번호(휴대폰·유선), 계좌번호처럼 줄표로 이어진 긴 번호, 전자우편 주소
 *
 * 지우지 못하는 것: 사진 속 글자. 사진은 사용자가 그린 가림 상자(와 PDF의 자동 가림 제안)에 맡긴다.
 * 호칭 없이 글에만 나온 이름("영희가 결제")도 알아보지 못한다.
 */

// 번호 모양. 순서가 중요하다: 구체적인 것부터 잡는다.
const PATTERNS: [label: string, re: RegExp, ok?: (s: string) => boolean][] = [
  ["메일", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["주민번호", /(?<!\d)\d{6}[- ]?[1-4]\d{6}(?!\d)/g],
  ["카드번호", /(?<!\d)\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{3,4}(?!\d)|(?<!\d)\d{4}[- ]?\d{2}\*{2}[- ]?\*{4}[- ]?\d{3,4}(?!\d)|(?<![\d.])\d{16}(?![\d.])/g],
  ["전화번호", /(?<!\d)01[016789][- ]?\d{3,4}[- ]?\d{4}(?!\d)|(?<!\d)0\d{1,2}[- )]\d{3,4}[- ]\d{4}(?!\d)/g],
  // 계좌번호, 사업자등록번호처럼 줄표로 이어진 번호. 날짜(2026-11-25)와 짧은 번호는 건드리지 않는다.
  ["번호", /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{1,4})?(?![\d-])/g, (s) => s.replace(/\D/g, "").length >= 10 && !/^\d{4}-\d{2}-\d{2}$/.test(s)],
];
// 이름 뒤에 붙는 말. 이 앞의 한글 2~4자를 이름으로 본다.
const AFTER_NAME = "님|씨|선생님|쌤|간사님?|총무님?|대표님?|회장님?|팀장님?|국장님?|이사님?|목사님?|집사님?|권사님?|교수님?|강사님?";
// 호칭 뒤에는 조사(이, 가, 께 …)나 띄어쓰기, 문장 부호가 온다. 그렇지 않으면 다른 낱말의 일부다.
const NAME_IN_TEXT = new RegExp(`(?<![가-힣])([가-힣]{2,4}?)(?=\\s?(?:${AFTER_NAME})(?:[이가은는을를께과와도의에]|[^가-힣]|$))`, "g");
// 이름이 아닌데 호칭 앞에 자주 오는 말. 이 말 자체는 이름으로 보지 않는다 ("박대표"는 이름으로 본다).
const NOT_NAMES = new Set(["담당자", "담당", "대표", "총무", "회장", "간사", "팀장", "국장", "이사", "목사", "집사", "권사", "교수", "강사", "선생", "고객", "손님", "회원", "후원자", "승인자", "등록자", "결제자", "제출자", "사장", "직원", "기사", "여러분", "관리자", "사용자", "누구", "아무", "본인", "모두", "부모", "학부모", "어머", "아버", "하나", "주인", "임원", "위원", "위원장", "참가자", "참석자", "봉사자", "자원봉사자"]);
const TOKEN = /\[(사람|메일|주민번호|카드번호|전화번호|번호)\d+\]/g;

export interface Vault {
  /** 이름인 줄 아는 값을 알려 준다 (기록의 결제자·제출자 등). */
  learn(names: Iterable<unknown>): void;
  /** 보내기 전: 이름과 번호를 자리표로 바꾼다. */
  hide(text: string): string;
  /** 받은 뒤: 자리표를 원래 값으로 되돌린다. 모르는 자리표는 그대로 둔다. */
  show(text: string): string;
  /** 자리표를 아예 뺀다. 바깥 검색어처럼 되돌릴 일이 없는 글에 쓴다. */
  strip(text: string): string;
  /** 지금까지 바꾼 것의 수 (종류별). 화면에 "이름 2개, 번호 1개를 가렸습니다"처럼 알릴 때 쓴다. */
  counts(): Record<string, number>;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isName = (s: string) => s.length >= 2 && s.length <= 20 && !NOT_NAMES.has(s) && !/^[\d\s.,-]+$/.test(s) && !TOKEN.test(s) && !/[○*]{2,}/.test(s);

export function createVault(): Vault {
  const toToken = new Map<string, string>(); // 원래 값 → 자리표
  const toValue = new Map<string, string>(); // 자리표 → 원래 값
  const seq: Record<string, number> = {};
  const tokenFor = (label: string, value: string): string => {
    const had = toToken.get(value);
    if (had) return had;
    seq[label] = (seq[label] ?? 0) + 1;
    const t = `[${label}${seq[label]}]`;
    toToken.set(value, t);
    toValue.set(t, value);
    return t;
  };
  const names = () => [...toToken.keys()].filter((v) => toToken.get(v)!.startsWith("[사람")).sort((a, b) => b.length - a.length);

  const vault: Vault = {
    learn(list) {
      for (const raw of list) {
        const s = typeof raw === "string" ? raw.trim() : "";
        TOKEN.lastIndex = 0;
        if (isName(s)) tokenFor("사람", s);
      }
    },
    hide(text) {
      if (!text) return text;
      let s = text;
      // 글 속에서 호칭이 붙은 이름을 찾아 둔다 (자리표로 이미 바뀐 것은 건너뛴다).
      for (const m of s.matchAll(NAME_IN_TEXT)) { TOKEN.lastIndex = 0; if (isName(m[1])) tokenFor("사람", m[1]); }
      for (const [label, re, ok] of PATTERNS) s = s.replace(re, (hit) => (ok && !ok(hit) ? hit : tokenFor(label, hit)));
      // 아는 이름은 긴 것부터 바꾼다 ("김영희"가 "영희"보다 먼저). 다른 한글 낱말의 한가운데는 건드리지 않는다.
      for (const n of names()) s = s.replace(new RegExp(`(?<![가-힣])${escapeRe(n)}`, "g"), toToken.get(n)!);
      return s;
    },
    show(text) {
      if (!text) return text;
      return text.replace(TOKEN, (t) => toValue.get(t) ?? t);
    },
    strip(text) {
      return vault.hide(text).replace(TOKEN, "").replace(/\s{2,}/g, " ").trim();
    },
    counts() {
      const out: Record<string, number> = {};
      for (const t of toValue.keys()) { const k = t.replace(/[\[\]\d]/g, ""); out[k] = (out[k] ?? 0) + 1; }
      return out;
    },
  };
  return vault;
}

/** 모델로 보내는 메시지 목록의 글을 모두 가린다. 그림(가린 사진)은 그대로 둔다. 원래 목록은 바꾸지 않는다. */
export function hideMessages(vault: Vault, messages: any[]): any[] {
  return messages.map((m) => {
    const out: any = { ...m };
    if (typeof m.content === "string") out.content = vault.hide(m.content);
    else if (Array.isArray(m.content)) out.content = m.content.map((part: any) => (part?.type === "text" && typeof part.text === "string" ? { ...part, text: vault.hide(part.text) } : part));
    if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls.map((c: any) => (c?.function ? { ...c, function: { ...c.function, arguments: vault.hide(String(c.function.arguments ?? "")) } } : c));
    return out;
  });
}

/* ---------- PDF의 글자에서 가릴 곳 찾기 ---------- */
/** 쪽 안의 글 한 토막과 그 자리 (쪽 크기에 대한 0~1 비율, 왼쪽 위가 원점). */
export interface TextSpot {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
// 이 말 뒤(같은 줄 오른쪽)에 개인정보가 온다. 온라인몰의 주문내역·거래명세서에 흔한 칸 이름이다.
const PERSONAL_LABEL = /(주문자|주문하신\s?분|수령인|수령자|수취인|받는\s?분|받는\s?사람|받으시는\s?분|보내는\s?분|구매자|회원명|성명|이름|예금주|연락처|전화|휴대폰|휴대전화|핸드폰|주소|배송지|이메일|e-?mail)/i;
/** 번호·메일처럼 모양만으로 개인정보인 줄 아는 글인지. */
export function looksPersonal(text: string): boolean {
  return PATTERNS.some(([, re, ok]) => [...text.matchAll(new RegExp(re.source, re.flags))].some((m) => !ok || ok(m[0])));
}
/**
 * PDF 한 쪽의 글자 자리에서 가릴 상자를 제안한다. 사람이 확인하고 지우거나 더할 수 있는 제안일 뿐이다.
 *  - 번호·메일 모양의 글은 그 자리를 가린다.
 *  - "수령인", "연락처", "주소" 같은 칸 이름이 있으면 같은 줄에서 그 뒤의 글을 다음 칸 이름 전까지 가린다.
 * PDF는 한 줄을 여러 토막으로(때로는 낱말이나 글자마다) 나눠 담으므로, 먼저 같은 줄의 토막을 이어 붙여 한 줄의 글로 보고 찾는다.
 */
export function suggestMaskBoxes(spots: TextSpot[], max = 40): { x: number; y: number; w: number; h: number }[] {
  const items = spots.filter((s) => s.text.trim() && s.w > 0 && s.h > 0).sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x);
  // 1) 세로 위치가 비슷한 토막끼리 한 줄로 묶는다.
  const rows: TextSpot[][] = [];
  for (const s of items) {
    const row = rows[rows.length - 1];
    const mid = s.y + s.h / 2;
    if (row && Math.abs(row[0].y + row[0].h / 2 - mid) < Math.max(row[0].h, s.h) * 0.6) row.push(s);
    else rows.push([s]);
  }
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const pad = 0.004;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    // 2) 줄의 글을 이어 붙이고, 토막마다 글에서의 자리(시작, 끝)를 적어 둔다.
    let text = "";
    const at: [number, number][] = [];
    row.forEach((s, i) => {
      if (i > 0 && s.x - (row[i - 1].x + row[i - 1].w) > s.h * 0.25 && !text.endsWith(" ")) text += " ";
      at.push([text.length, text.length + s.text.length]);
      text += s.text;
    });
    // 3) 가릴 글의 범위: 번호·메일 모양, 그리고 칸 이름 뒤부터 다음 칸 이름 앞까지.
    const ranges: [number, number][] = [];
    for (const [, re, ok] of PATTERNS) for (const m of text.matchAll(new RegExp(re.source, re.flags))) if (!ok || ok(m[0])) ranges.push([m.index!, m.index! + m[0].length]);
    const labels = [...text.matchAll(new RegExp(PERSONAL_LABEL.source, "gi"))];
    labels.forEach((m, k) => {
      let from = m.index! + m[0].length;
      const to = labels[k + 1]?.index ?? text.length;
      while (from < to && /[\s:：)\]|·]/.test(text[from])) from++;
      if (text.slice(from, to).replace(/[\s:：|·,.-]/g, "").length >= 2) ranges.push([from, to]);
    });
    if (!ranges.length) continue;
    // 4) 범위에 걸친 토막을 고르고, 나란히 붙은 토막은 한 상자로 합친다.
    const hit = row.map((s, i) => /[^\s:：|·,.-]/.test(s.text) && ranges.some(([a, b]) => at[i][0] < b && at[i][1] > a && text.slice(Math.max(a, at[i][0]), Math.min(b, at[i][1])).trim() !== ""));
    let run: TextSpot[] = [];
    const flush = () => {
      if (!run.length) return;
      const x = clamp(Math.min(...run.map((s) => s.x)) - pad), y = clamp(Math.min(...run.map((s) => s.y)) - pad);
      out.push({ x, y, w: clamp(Math.max(...run.map((s) => s.x + s.w)) + pad) - x, h: clamp(Math.max(...run.map((s) => s.y + s.h)) + pad) - y });
      run = [];
    };
    // 가릴 토막 사이에 낀 점이나 쉼표 때문에 상자가 끊기지 않게 한다.
    row.forEach((s, i) => { if (hit[i]) run.push(s); else if (/[^\s:：|·,.-]/.test(s.text)) flush(); });
    flush();
  }
  return out.slice(0, max);
}
