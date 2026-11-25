// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 소개 페이지 (/). 취지, 실제 화면으로 보는 사용법, 기술 구조, 출시 알림 신청.
 * 화면 사진(public/landing/)은 e2e/landing-shots.spec.ts가 실제 앱을 캡처해 만든다.
 * 배치는 app/landing.css에 있다. 앱 화면(/app)과 달리 이 페이지는 Astryx 부품 대신 직접 짠 배치를 쓴다.
 */
"use client";

import { Button } from "@astryxdesign/core/Button";
import { useEffect } from "react";
import "./landing.css";
import { WaitlistForm } from "./waitlist-form";

// 소스 저장소 주소. 비어 있으면 "소스 코드 받기" 버튼 대신 "공개 준비 중"으로 안내한다.
const SOURCE_URL = process.env.NEXT_PUBLIC_SOURCE_URL || "";

function Phone({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="lp-phone">
      {/* 실제 앱 화면을 브라우저에서 캡처한 사진 */}
      <img src={`/landing/${src}.png`} alt={alt} width={780} height={1560} loading="lazy" />
    </div>
  );
}

const steps: { title: string; body: string; shots: [string, string][] }[] = [
  {
    title: "영수증을 올립니다. 한 장도, 서른 장도",
    body: "행사가 끝나고 모아 둔 영수증 사진을 한꺼번에 고르면 됩니다. 어느 사업의 지출인지만 정해 두면 나머지는 에이전트가 한 장씩 읽어 정리합니다.",
    shots: [["1-upload", "영수증 여러 장을 한꺼번에 올리는 화면. 사진 네 장이 대기 중이다."]],
  },
  {
    title: "이름과 카드번호는 가립니다",
    body: "사진 위를 손가락으로 끌어 가릴 부분을 칠합니다. AI에는 가린 사진만 보내고, 원본은 기록을 올린 사람과 승인하는 사람만 볼 수 있습니다.",
    shots: [["2-mask", "영수증에서 카드번호와 이름 부분을 검게 가린 화면."]],
  },
  {
    title: "에이전트가 읽고, 모르는 것만 묻습니다",
    body: "일자·금액·가게·결제 방식을 읽어 기록을 채우고, 지난 기록을 보고 어느 사업인지 맞춥니다. 무엇을 위해 샀는지, 누가 냈는지처럼 사진만으로는 알 수 없는 것만 물어봅니다. 에이전트가 한 일은 순서대로 모두 보입니다.",
    shots: [["3-agent", "에이전트가 한 일이 순서대로 나열되고, 목적과 환급 여부를 묻는 질문 카드가 보이는 화면."]],
  },
  {
    title: "지출 한 건이 '증빙 묶음'으로 완성됩니다",
    body: "영수증, 목적, 사업, 결제, 책임이 한 묶음으로 정리됩니다. 에이전트가 공개된 정산 지침을 찾아 챙겨야 할 자료를 출처 링크와 함께 알려 줍니다. 내용을 확인하고 확정하는 것은 사람입니다.",
    shots: [["4-bundle", "한 줄 요약, 영수증·지출·목적·사업·결제·책임 여섯 항목, 확인할 자료 두 건이 출처와 함께 보이는 화면."]],
  },
  {
    title: "승인하고, 마감 전에 빠진 것을 점검합니다",
    body: "승인하는 사람은 자기 휴대폰에서 기록을 보고 승인합니다. 마감 점검 에이전트가 전체 기록을 훑어 보완이 필요한 건마다 담당자에게 보낼 요청 문안을 써 둡니다. 보내는 것은 사람이 합니다.",
    shots: [["5-review", "보완이 필요한 두 건과, 마감 점검 에이전트가 쓴 브리핑과 보완 요청 문안이 보이는 화면."]],
  },
  {
    title: "결산보고서가 만들어지고, 영수증도 바로 확인합니다",
    body: "예산 항목별·결제 방식별 집행, 지출 내역, 아직 확인할 항목, 환급 대상이 한 장의 보고서로 정리됩니다. 보고서 안에서 건별 영수증을 열어 볼 수 있고, 표 파일(CSV)과 보고서 파일로 내려받거나 인쇄할 수 있습니다.",
    shots: [["6-report", "결산보고서 초안. 요약, 예산 항목별 집행, 결제 방식별 집행 표가 보인다."], ["7-receipts", "결산보고서의 영수증 구역. 가린 사진과 원본을 바꿔 볼 수 있다."]],
  },
  {
    title: "함께 쓰고, 후원자에게 공유합니다",
    body: "초대 링크를 보내면 구성원이 각자 기기에서 같은 기록을 씁니다. 후원자에게는 보기 전용 링크를 보냅니다. 후원자는 결산보고서와 가린 영수증만 볼 수 있고, 기록이 바뀌면 보고서도 따라 바뀝니다.",
    shots: [["8-share", "설정 화면의 단체 공간. 초대 링크와 후원자용 보기 링크가 있다."], ["9-sponsor", "후원자가 링크로 연 결산보고서. 읽기 전용이며 이름이 가려져 있다."]],
  },
];

export default function Landing() {
  // 예전 초대 링크(/#join=...)로 들어오면 앱으로 보낸다.
  useEffect(() => {
    if (window.location.hash.startsWith("#join=")) window.location.replace(`/app${window.location.hash}`);
  }, []);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap">
          <span className="lp-brand"><img src="/icon-192.png" alt="" />열린영수증</span>
          <nav className="lp-nav-links">
            <span className="lp-hide-sm"><Button label="어떻게 쓰나요" variant="ghost" size="sm" href="#how" /></span>
            <Button label="사용 안내" variant="ghost" size="sm" href="/guide" />
            <span className="lp-hide-sm"><Button label="기술" variant="ghost" size="sm" href="#tech" /></span>
            <Button label="출시 알림" variant="ghost" size="sm" href="#waitlist" />
            <Button label="지금 써 보기" variant="primary" size="sm" href="/app" />
          </nav>
        </div>
      </header>

      <main>
        <section>
          <div className="lp-wrap lp-hero">
            <div className="lp-hero-text">
              <p className="lp-eyebrow">작은 단체를 위한 정산 에이전트</p>
              <h1>행사가 끝나면, 영수증만 올리세요</h1>
              <p className="lp-lead">열린영수증은 회계 담당자가 따로 없는 단체·동아리·모임의 행사 정산과 월말·연말 보고를 돕습니다. AI 에이전트가 영수증을 읽어 기록을 채우고, 결산보고서까지 만들어 둡니다.</p>
              <div className="lp-cta">
                <Button label="지금 써 보기" variant="primary" size="lg" href="/app" />
                <Button label="사용 안내 보기" size="lg" href="/guide" />
                <Button label="출시 알림 받기" size="lg" href="#waitlist" />
              </div>
              <p className="lp-note">설치나 가입 없이 바로 열립니다. 가상 데이터로 먼저 둘러볼 수 있고, 지금은 정식 출시 전 시험 버전입니다.</p>
            </div>
            <Phone src="3-agent" alt="에이전트가 영수증을 읽어 기록을 채우고, 모르는 것만 질문하는 화면" />
          </div>
        </section>

        <section className="lp-tint">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">왜 만들었나요</p>
              <h2>문제는 영수증 한 장이 아니라, 지출의 맥락이 흩어지는 순간입니다</h2>
              <p className="lp-sub">작은 단체에서는 여러 사람이 각자의 방식으로 돈을 씁니다. 누가, 무엇을 위해, 어느 사업에서 썼는지는 그때만 알고, 정산할 때는 다시 물어야 합니다.</p>
            </div>
            <ol className="lp-flow">
              <li><b>지출이 생깁니다</b><span>행사 준비 중에 담당자가 먼저 결제</span></li>
              <li><b>자료가 흩어집니다</b><span>종이 영수증, 메신저 사진, 이체 내역이 따로</span></li>
              <li><b>마감이 다가옵니다</b><span>누가 무슨 목적으로 썼는지 다시 확인</span></li>
              <li><b>정산을 다시 합니다</b><span>빠진 자료를 찾고 설명과 승인을 요청</span></li>
            </ol>
            <p className="lp-sub" style={{ marginTop: "var(--spacing-6)" }}>열린영수증은 자료를 모아 두는 앱이 아닙니다. 지출이 생겼을 때, 또는 행사가 끝난 직후에 정산 가능한 기록을 완성해 두는 도우미입니다.</p>
          </div>
        </section>

        <section>
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">이럴 때 씁니다</p>
              <h2>행사 정산부터 연말 보고까지</h2>
            </div>
            <div className="lp-grid3">
              <div className="lp-card"><h3>행사가 끝난 뒤 정산</h3><p>워크숍, 캠프, 발표회가 끝나면 모아 둔 영수증을 한꺼번에 올립니다. 그 행사의 지출이 기록과 보고서로 정리됩니다.</p></div>
              <div className="lp-card"><h3>월말 보고</h3><p>마감 점검 에이전트가 증빙이 빠진 건, 승인이 남은 건을 찾아 담당자에게 보낼 요청 문안까지 써 둡니다.</p></div>
              <div className="lp-card"><h3>연말 결산과 후원자 보고</h3><p>사업별 결산보고서를 후원자에게 링크로 공유합니다. 후원자는 가린 영수증까지 직접 확인할 수 있습니다.</p></div>
            </div>
          </div>
        </section>

        <section id="how" className="lp-tint">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">어떻게 쓰나요</p>
              <h2>처음부터 끝까지, 실제 화면으로 보기</h2>
              <p className="lp-sub">아래 화면은 모두 실제 앱을 휴대폰 크기의 브라우저로 열어 캡처한 것입니다. 보이는 단체와 영수증은 가상 데이터입니다.</p>
            </div>
            <ol className="lp-steps">
              {steps.map((s, i) => (
                <li className="lp-step" key={s.title}>
                  <div className="lp-step-text">
                    <span className="lp-step-no">{i + 1}단계</span>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                  <div className="lp-step-media">
                    {s.shots.length === 1
                      ? <Phone src={s.shots[0][0]} alt={s.shots[0][1]} />
                      : <div className="lp-pair">{s.shots.map(([src, alt]) => <Phone key={src} src={src} alt={alt} />)}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section>
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">누가 무엇을 보나요</p>
              <h2>역할마다 보이는 범위가 다릅니다</h2>
            </div>
            <div className="lp-table-wrap">
              <table className="lp-table">
                <thead><tr><th>역할</th><th>볼 수 있는 것</th><th>할 수 있는 것</th></tr></thead>
                <tbody>
                  <tr><th>등록자 (총무·재정 담당)</th><td>기록 전체, 결산보고서, 가린 영수증, 원본 영수증</td><td>기록 올리기·고치기, 보고서 공유</td></tr>
                  <tr><th>승인자 (대표)</th><td>등록자와 같습니다</td><td>승인. 승인한 사람의 이름이 기록됩니다</td></tr>
                  <tr><th>후원자</th><td>결산보고서와 가린 영수증</td><td>보기와 인쇄. 원본을 볼 수 없고 아무것도 고칠 수 없습니다</td></tr>
                </tbody>
              </table>
            </div>
            <p className="lp-sub" style={{ marginTop: "var(--spacing-6)" }}>역할마다 무엇을 누르면 되는지, 화면을 보며 따라 할 수 있는 안내를 준비했습니다.</p>
            <div className="lp-cta" style={{ marginTop: "var(--spacing-3)" }}>
              <Button label="등록자 안내" href="/guide#submitter" />
              <Button label="승인자 안내" href="/guide#approver" />
              <Button label="후원자 안내" href="/guide#sponsor" />
            </div>
          </div>
        </section>

        <section className="lp-tint">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">지키는 원칙</p>
              <h2>AI가 돕고, 사람이 결정합니다</h2>
            </div>
            <div className="lp-grid3">
              <div className="lp-card"><h3>판정하지 않습니다</h3><p>"위반"이나 "부적법" 같은 결론을 내리지 않습니다. 확인할 항목과 다음에 할 일만 알려 줍니다.</p></div>
              <div className="lp-card"><h3>확정과 승인은 사람이</h3><p>에이전트에게는 승인하거나 돈을 보내거나 메시지를 발송하는 기능이 없습니다. 기록의 상태는 사람이 눌러야 바뀝니다.</p></div>
              <div className="lp-card"><h3>근거에는 출처를</h3><p>챙길 자료를 안내할 때는 실제로 검색된 공개 문서의 링크를 함께 보여 줍니다. 출처가 없는 안내는 보여 주지 않습니다.</p></div>
              <div className="lp-card"><h3>AI에는 가린 사진만</h3><p>이름과 카드번호를 가린 사진만 AI에 보냅니다. 원본은 기록을 올린 사람과 승인하는 사람만 볼 수 있습니다.</p></div>
              <div className="lp-card"><h3>기록은 암호화해서 공유</h3><p>여러 기기가 함께 쓸 때 기록과 사진은 기기에서 암호화한 뒤 오갑니다. 열쇠는 초대 링크에만 있어 서버는 내용을 읽을 수 없습니다.</p></div>
              <div className="lp-card"><h3>가입 없이 시작</h3><p>계정을 만들지 않아도 됩니다. 기록은 먼저 내 기기에 저장되고, 함께 쓰기로 했을 때만 공유됩니다.</p></div>
            </div>
          </div>
        </section>

        <section id="tech">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">기술</p>
              <h2>표준 규격으로 열려 있는 AI 에이전트</h2>
              <p className="lp-sub">열린영수증의 에이전트는 이 웹앱 안에 갇혀 있지 않습니다. 웹 에이전트 표준 규격인 AG-UI 프로토콜로 열려 있어, 다른 웹앱이나 사내 도구, 메신저 봇에서도 같은 에이전트를 그대로 부를 수 있습니다.</p>
            </div>
            <ol className="lp-flow">
              <li><b>화면</b><span>웹앱, 또는 AG-UI를 지원하는 다른 프런트엔드</span></li>
              <li><b>AG-UI 프로토콜 1.0</b><span>실행, 도구 호출, 상태 변경, 질문을 표준 이벤트로 주고받음</span></li>
              <li><b>에이전트</b><span>목표를 받아 도구를 스스로 골라 가며 끝날 때까지 반복</span></li>
              <li><b>Liner API</b><span>영수증을 읽고 판단하는 모델, 공개 지침을 찾는 검색</span></li>
            </ol>
            <div className="lp-two" style={{ marginTop: "var(--spacing-8)" }}>
              <div>
                <h3>에이전트가 쓰는 도구</h3>
                <ul className="lp-list" style={{ marginTop: "var(--spacing-3)" }}>
                  <li><b>지출 에이전트</b>: 기록 채우기, 지난 기록 조회, 증빙 묶음 점검, 사용자에게 묻기, 공개 지침 검색, 마무리</li>
                  <li><b>마감 점검 에이전트</b>: 기록 훑기, 건별 살펴보기, 공개 지침 검색, 보완 요청 문안 쓰기, 브리핑</li>
                  <li><b>묶음 에이전트</b>: 따로 올라온 카드영수증·거래명세서·주문 화면 가운데 같은 거래의 서류를 찾아 한 건으로 합치자고 제안</li>
                  <li>정해진 순서를 따르지 않고 상황에 따라 도구를 고릅니다. 검색 결과가 부실하면 검색어를 바꿔 다시 찾습니다.</li>
                </ul>
              </div>
              <div>
                <h3>확장을 생각한 구조</h3>
                <ul className="lp-list" style={{ marginTop: "var(--spacing-3)" }}>
                  <li><b>표준 클라이언트로 연결</b>: 공식 AG-UI 클라이언트로 몇 줄이면 에이전트를 부를 수 있습니다. 이 웹앱도 같은 방법을 씁니다.</li>
                  <li><b>서버는 상태를 갖지 않습니다</b>: 대화와 기록은 요청에 실려 오가므로 서버를 늘리기 쉽습니다.</li>
                  <li><b>질문도 표준 방식으로</b>: 사용자에게 묻는 일은 화면이 제공하는 도구 호출로 처리해, 어떤 화면에서도 같은 흐름으로 동작합니다.</li>
                </ul>
              </div>
            </div>
            <div className="lp-head" id="ledger" style={{ marginTop: "var(--spacing-10)" }}>
              <h3>각자 가진 서명 원장</h3>
              <p className="lp-sub">한 사람이 가진 장부는 그 사람이 고치면 그만입니다. 열린영수증은 구성원 기기마다 서명 원장을 두고, 서로의 사본을 나눠 갖습니다. 블록체인에서 쓰는 해시 사슬과 전자서명을 가져왔고, 채굴이나 코인은 없습니다.</p>
            </div>
            <ol className="lp-flow" data-testid="ledger-flow">
              <li><b>1. 기기 열쇠</b><span>참여한 기기마다 서명 열쇠를 만듭니다. 비밀 열쇠는 기기 밖으로 나가지 않습니다</span></li>
              <li><b>2. 서명한 줄</b><span>올림·수정·승인·삭제마다 한 줄을 남기고, 각 줄은 앞줄의 해시를 담아 사슬로 이어집니다</span></li>
              <li><b>3. 서로 가진 사본</b><span>모든 구성원 기기가 모든 원장의 사본을 갖고, 동기화할 때마다 서명과 사슬을 검증합니다</span></li>
              <li><b>4. 지문 전달</b><span>결산보고서와 함께 원장의 지문을 냅니다. 받은 사람은 나중에 바뀌었는지 견줄 수 있습니다</span></li>
            </ol>
            <ul className="lp-list" style={{ marginTop: "var(--spacing-4)" }}>
              <li><b>고치면 드러납니다</b>: 줄 하나를 고치거나 빼면 서명과 뒤따르는 해시가 어긋나, 다른 기기가 그 사본을 받지 않습니다.</li>
              <li><b>승인을 검증합니다</b>: 승인자 역할의 기기가, 올린 기기와 다른 열쇠로 서명한 승인만 인정합니다.</li>
              <li><b>보장하는 범위</b>: 기록이 서명된 뒤 바뀌지 않았다는 것을 보여 줍니다. 기록 내용이 사실인지는 사람이 확인해야 합니다.</li>
            </ul>
            <div className="lp-cta" style={{ marginTop: "var(--spacing-6)" }}>
              <Button label="개발자 안내 보기" href="/developers" />
              <Button label="AG-UI 프로토콜 문서" variant="ghost" href="https://docs.ag-ui.com/" target="_blank" rel="noreferrer" />
            </div>
          </div>
        </section>

        <section className="lp-tint" id="open-source">
          <div className="lp-wrap lp-two">
            <div className="lp-head" style={{ marginBottom: 0 }}>
              <p className="lp-eyebrow">오픈소스</p>
              <h2>누구나 내려받아 고쳐 쓸 수 있습니다</h2>
              <p className="lp-sub">열린영수증의 소스 코드는 GNU 일반 공중 사용 허가서(GPL) 버전 3 또는 그 이후 버전을 따릅니다.</p>
              {SOURCE_URL
                ? <div className="lp-cta"><Button label="소스 코드 받기" href={SOURCE_URL} target="_blank" rel="noreferrer" /></div>
                : <p className="lp-note">소스 저장소는 공개를 준비하고 있습니다. 주소가 정해지면 이 자리에 올리고, 출시 알림을 신청하신 분께도 함께 알려 드리겠습니다.</p>}
            </div>
            <ul className="lp-list">
              <li><b>자유롭게 사용</b>: 어떤 단체든 목적에 제한 없이 쓸 수 있습니다.</li>
              <li><b>고쳐서 사용</b>: 우리 단체의 양식이나 절차에 맞게 고칠 수 있습니다. 자신의 서버와 자신의 AI 키로 직접 운영할 수도 있습니다.</li>
              <li><b>다시 나누기</b>: 고친 것을 다른 단체와 나눌 수 있습니다. 이때 받은 사람도 같은 자유를 누리도록 소스를 같은 조건(GPL)으로 공개해야 합니다.</li>
              <li><b>보증은 없습니다</b>: 무료로 공개하는 소프트웨어이며, 사용 결과에 대한 보증이나 책임은 지지 않습니다.</li>
            </ul>
          </div>
        </section>

        <section>
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">만든 뜻</p>
              <h2>공익을 위한 도구로 쓰겠습니다</h2>
              <p className="lp-sub">열린영수증은 돈을 벌기 위한 서비스가 아니라, 작은 공익 단체가 회계 부담을 덜고 후원자와 구성원에게 돈의 쓰임을 투명하게 보여 줄 수 있도록 만든 도구입니다. 대회 출품으로 시작했지만, 행사가 끝나고 실제로 정산에 쓰이는 도구로 다듬어 가려 합니다.</p>
            </div>
            <ul className="lp-list">
              <li>회계 지식이 없어도 쓸 수 있게, 쉬운 말과 큰 글씨로 만듭니다.</li>
              <li>판단과 책임은 사람에게 남깁니다. 에이전트는 준비만 합니다.</li>
              <li>기록과 사진은 단체의 것입니다. 광고에 쓰거나 다른 곳에 넘기지 않습니다.</li>
              <li>소스를 공개해, 누구나 확인하고 고쳐 쓸 수 있게 합니다.</li>
            </ul>
          </div>
        </section>

        <section id="waitlist" className="lp-tint">
          <div className="lp-wrap">
            <div className="lp-head" style={{ alignItems: "center", textAlign: "center" }}>
              <p className="lp-eyebrow">출시 알림</p>
              <h2>정식으로 출시하면 알려 드리겠습니다</h2>
              <p className="lp-sub">이메일을 남겨 주시면 정식 출시 때 안내 메일을 보내 드립니다. 그 전에도 지금 버전은 바로 써 보실 수 있습니다.</p>
            </div>
            <div className="lp-wait"><WaitlistForm /></div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <span>열린영수증 · GPL-3.0-or-later · 화면의 단체와 영수증은 가상 데이터입니다.</span>
          <span><a href="/app">앱 열기</a> · <a href="/guide">사용 안내</a> · <a href="/developers">개발자 안내</a>{SOURCE_URL ? <> · <a href={SOURCE_URL} target="_blank" rel="noreferrer">소스 코드</a></> : null}</span>
        </div>
      </footer>
    </div>
  );
}
