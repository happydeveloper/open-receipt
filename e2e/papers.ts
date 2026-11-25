// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 테스트와 화면 캡처에 쓰는 가상 서류 네 장. 화면에 그려서 사진으로 만든다.
 * 같은 거래의 카드영수증·거래명세서·주문 화면, 그리고 다른 거래의 간이영수증이다.
 * 가맹점 표기와 날짜를 일부러 조금씩 다르게 했다.
 */
import type { Browser } from "@playwright/test";

const page0 = (body: string) => `<body style="font-family:'Apple SD Gothic Neo',sans-serif;padding:28px;margin:0;font-size:17px;line-height:1.7">${body}<p style="color:#777;font-size:13px">시연용 가상 자료입니다. 실제 거래가 아닙니다.</p></body>`;
export const sheets: [string, string][] = [
  ["카드영수증.png", page0(`<h2 style="text-align:center">신용카드 매출전표</h2><p>가맹점 가상페이먼츠(가상몰)<br>거래일시 2026-11-18 21:14<br>카드번호 1234-56**-****-3456 (법인)<br>승인번호 30112233</p><hr><p>공급가액 24,000원<br>부가세 2,400원<br><b style="font-size:22px">합계 26,400원</b></p>`)],
  ["거래명세서.png", page0(`<h2>거래명세서</h2><p>공급자 (주)가상몰 · 사업자번호 000-00-00000<br>발행일 2026-11-19 · 주문번호 V-0000-0001</p><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%"><tr><th>품목</th><th>수량</th><th>금액</th></tr><tr><td>과자 모둠 세트</td><td>2</td><td>12,000</td></tr><tr><td>음료 1.5L</td><td>4</td><td>8,400</td></tr><tr><td>종이컵·접시</td><td>1</td><td>6,000</td></tr><tr><td colspan="2"><b>합계 (부가세 포함)</b></td><td><b>26,400원</b></td></tr></table>`)],
  ["주문화면.png", page0(`<p style="background:#eef;padding:8px">가상몰 &gt; 마이페이지 &gt; 주문 상세</p><h3>주문 완료</h3><p>주문번호 V-0000-0001 · 주문일 2026-11-18<br>과자 모둠 세트 외 2건</p><p>상품 금액 26,400원<br>배송비 0원<br><b>총 결제 금액 26,400원</b><br>결제 수단 신용카드</p><p>배송 상태: 배송 준비 중</p>`)],
  ["인쇄영수증.png", page0(`<h2 style="text-align:center">영 수 증</h2><p>가상인쇄소<br>2026-11-18 11:02</p><hr><p>현수막 3m × 1 &nbsp; 18,000</p><hr><p><b style="font-size:22px">합계 18,000원</b><br>카드 결제</p>`)],
];
export async function draw(browser: Browser, html: string): Promise<Buffer> {
  const p = await (await browser.newContext({ viewport: { width: 460, height: 560 }, deviceScaleFactor: 2 })).newPage();
  await p.setContent(html);
  const png = await p.screenshot();
  await p.context().close();
  return png;
}

