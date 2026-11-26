// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시연 영상의 화면 구성.
 *
 * 왼쪽에는 실제 앱을 녹화한 휴대폰 화면, 오른쪽에는 지금 누구의 화면인지(역할), 전체 순서 가운데 어디인지(장),
 * 그리고 프레이미의 말풍선(자막)을 둔다. 자막과 같은 문장을 내레이션으로 읽는다.
 * 에이전트를 기다리는 구간은 빠르게 돌리고, 그때는 "빠르게 감기" 표시를 띄운다.
 */
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Framey } from "./Framey";

export const FPS = 30;
export type EdlItem = {
  id: string;
  kind: "title" | "screen";
  chapter: string;
  role: string;
  text: string;
  frames: number;
  audio: string;
  /** 이 장면에서 쓰이는 Liner API (있을 때만 표시) */
  api?: string;
  /** 화면 장면일 때: 녹화 파일, 시작 위치(초), 재생 속도 */
  clip?: string;
  startSec?: number;
  rate?: number;
};
export type Edl = { title: string; items: EdlItem[] };

const FONT = '"Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
const INK = "#1c2430", MUTED = "#5d6878", GREEN = "#2f9e62", PAPER = "#f4f1ea";
const ROLE_COLOR: Record<string, string> = { "등록자 · 총무": "#2f6fde", "승인자 · 대표": "#8a4fd6", "후원자": "#d9822b", "열린영수증": GREEN };
// 내레이션은 소리 나는 대로 적었으므로, 자막에서는 원래 표기로 돌려놓는다.
const caption = (t: string) => t.replace(/에이아이/g, "AI").replace(/에이피아이/g, "API");
const HEADLINE: Record<string, [string, string]> = {
  n0: ["행사가 끝나면 시작되는 일", "흩어진 영수증, 다시 묻는 목적, 밤새는 정산"],
  n1: ["열린영수증", "작은 단체를 위한 정산 에이전트 · Liner API로 동작"],
  n8: ["Liner API로 움직입니다", "Liner Model API  ·  Liner Search API"],
  n9: ["준비는 에이전트가, 결정은 사람이", "open-receipt-six.vercel.app"],
};

const Bubble = ({ text, local }: { text: string; local: number }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: local, fps, config: { damping: 200 }, durationInFrames: 10 });
  return (
    <div style={{ position: "relative", background: "#fff", borderRadius: 28, padding: "30px 36px", fontSize: 40, lineHeight: 1.5, fontWeight: 600, color: INK, boxShadow: "0 10px 30px rgba(28,36,48,.12)", opacity: pop, transform: `translateY(${(1 - pop) * 14}px)`, wordBreak: "keep-all" }}>
      <div style={{ position: "absolute", left: -18, bottom: 46, width: 0, height: 0, borderTop: "16px solid transparent", borderBottom: "16px solid transparent", borderRight: "22px solid #fff" }} />
      {caption(text)}
    </div>
  );
};

const Chapters = ({ items, current }: { items: string[]; current: string }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    {items.map((c) => {
      const on = c === current;
      return (
        <div key={c} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: on ? 800 : 500, color: on ? INK : "#9aa3af" }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: on ? GREEN : "#cfd5dc" }} />
          {c}
        </div>
      );
    })}
  </div>
);

export const Demo = ({ title, items }: Edl) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // 지금 장면과, 그 장면이 시작된 뒤 흐른 프레임
  let start = 0, index = 0;
  for (let i = 0; i < items.length; i++) {
    if (frame < start + items[i].frames) { index = i; break; }
    start += items[i].frames;
    index = i;
  }
  const cur = items[index];
  if (!cur) return <AbsoluteFill style={{ background: PAPER }} />;
  const local = frame - start;
  const chapters = [...new Set(items.filter((i) => i.kind === "screen").map((i) => i.chapter))];
  const fast = cur.kind === "screen" && (cur.rate ?? 1) > 1.15;
  const starts: number[] = [];
  items.reduce((n, it, i) => { starts[i] = n; return n + it.frames; }, 0);

  return (
    <AbsoluteFill style={{ background: PAPER, fontFamily: FONT, color: INK }}>
      {/* 소리와 화면: 장면마다 하나씩 */}
      {items.map((it, i) => (
        <Sequence key={it.id} from={starts[i]} durationInFrames={it.frames} layout="none">
          <Sequence from={6} layout="none"><Audio src={staticFile(it.audio)} /></Sequence>
          {it.kind === "screen" && it.clip ? (
            <div style={{ position: "absolute", left: 130, top: 30, width: 496, height: 992, borderRadius: 46, border: `12px solid ${INK}`, overflow: "hidden", background: "#fff", boxShadow: "0 24px 60px rgba(28,36,48,.25)", boxSizing: "content-box" }}>
              <OffthreadVideo src={staticFile(it.clip)} startFrom={Math.round((it.startSec ?? 0) * FPS)} playbackRate={it.rate ?? 1} muted style={{ width: 496, height: 992, display: "block" }} />
            </div>
          ) : null}
        </Sequence>
      ))}

      {cur.kind === "screen" ? (
        <>
          {fast ? (
            <div style={{ position: "absolute", left: 130 + 12 + 496 - 250, top: 30 + 12 + 20, width: 230, textAlign: "center", background: "rgba(28,36,48,.86)", color: "#fff", borderRadius: 18, padding: "8px 0", fontSize: 24, fontWeight: 700 }}>
              ▶▶ 빠르게 감기 ×{(cur.rate ?? 1).toFixed(1)}
            </div>
          ) : null}
          <div style={{ position: "absolute", left: 760, top: 64, right: 90, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 30, fontWeight: 800, color: INK }}>{title}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: GREEN }}>Liner Model API · Liner Search API로 동작합니다</div>
            </div>
            <div style={{ background: ROLE_COLOR[cur.role] ?? INK, color: "#fff", borderRadius: 999, padding: "12px 30px", fontSize: 32, fontWeight: 800 }}>{cur.role}의 화면</div>
          </div>
          <div style={{ position: "absolute", left: 760, top: 190 }}><Chapters items={chapters} current={cur.chapter} /></div>
          {cur.api ? (
            <div style={{ position: "absolute", left: 760, top: 560, display: "flex", alignItems: "center", gap: 14, background: INK, color: "#fff", borderRadius: 18, padding: "16px 26px", fontSize: 30, fontWeight: 800 }}>
              <div style={{ width: 16, height: 16, borderRadius: 8, background: "#7ee2a8", opacity: 0.55 + 0.45 * Math.abs(Math.sin(frame / 8)) }} />
              지금 쓰는 것: {cur.api}
            </div>
          ) : null}
          <div style={{ position: "absolute", left: 730, right: 90, bottom: 70, display: "flex", alignItems: "flex-end", gap: 26 }}>
            <div style={{ flex: "none" }}><Framey size={230} talking={local > 6 && local < cur.frames - 12} /></div>
            <div style={{ flex: 1, paddingBottom: 26 }}><Bubble text={cur.text} local={local} /></div>
          </div>
        </>
      ) : (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "0 160px" }}>
          <div style={{ opacity: interpolate(local, [0, 10], [0, 1], { extrapolateRight: "clamp" }), display: "flex", flexDirection: "column", alignItems: "center", gap: 22 }}>
            <Framey size={300} talking={local > 6 && local < cur.frames - 12} />
            <div style={{ fontSize: 84, fontWeight: 900, letterSpacing: -2 }}>{HEADLINE[cur.id]?.[0] ?? title}</div>
            <div style={{ fontSize: 40, fontWeight: 700, color: GREEN }}>{HEADLINE[cur.id]?.[1] ?? ""}</div>
            <div style={{ marginTop: 26, maxWidth: 1400, textAlign: "center", fontSize: 40, lineHeight: 1.5, fontWeight: 600, color: INK, background: "#fff", borderRadius: 28, padding: "28px 44px", boxShadow: "0 10px 30px rgba(28,36,48,.12)", wordBreak: "keep-all" }}>{caption(cur.text)}</div>
          </div>
        </AbsoluteFill>
      )}

      {/* 진행 막대 */}
      <div style={{ position: "absolute", left: 0, bottom: 0, height: 10, width: "100%", background: "#e3ded2" }}>
        <div style={{ height: "100%", width: `${(frame / durationInFrames) * 100}%`, background: GREEN }} />
      </div>
      <div style={{ position: "absolute", right: 90, bottom: 24, fontSize: 20, color: MUTED }}>화면의 단체, 영수증, 거래명세서는 모두 가상 자료입니다 · 에이전트 응답은 실제 Liner API 결과입니다</div>
    </AbsoluteFill>
  );
};
