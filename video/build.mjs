// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 시연 영상 만들기: 편집 목록을 짜고 Remotion으로 인코딩한다.
 *   node video/build.mjs            # video/out/open-receipt-demo.mp4
 *   node video/build.mjs --still 900  # 900번째 프레임만 그림으로 (구성 확인용)
 *
 * 편집 목록(raw/edl.json)은 대본(script.json), 내레이션 길이(raw/durations.json),
 * 녹화 때 적어 둔 장면 위치(raw/timeline.json)를 합쳐 만든다.
 * 장면 길이는 내레이션에 맞춘다. 화면이 그보다 길면(에이전트를 기다리는 구간) 빠르게 돌린다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => JSON.parse(readFileSync(path.join(dir, f), "utf8"));
const script = read("script.json"), speech = read("raw/durations.json"), timeline = read("raw/timeline.json");
const FPS = 30, LEAD = 0.15; // 녹화는 시각을 재기 조금 전에 시작된다

const items = [];
for (const s of script.segments) {
  const say = speech[s.id] ?? 3;
  const base = { id: s.id, kind: s.kind, chapter: s.chapter, role: s.role, text: s.text, audio: `audio/${s.id}.wav` };
  if (s.kind === "title") { items.push({ ...base, frames: Math.round((say + 0.9) * FPS) }); continue; }
  const m = timeline.marks.find((x) => x.id === s.id);
  if (!m) { console.log(`건너뜀: ${s.id} (녹화에 없는 장면)`); continue; }
  const natural = (m.to - m.from) / 1000;
  // 말이 끝날 때까지는 보여 주고, 그보다 2.5초 넘게 길면 줄인다.
  const show = Math.max(say + 0.5, Math.min(natural, say + 2.5));
  items.push({ ...base, frames: Math.round(show * FPS), clip: `clips/${m.dev}.mp4`, startSec: m.from / 1000 + LEAD, rate: Math.max(1, natural / show) });
}
const total = items.reduce((n, it) => n + it.frames, 0) / FPS;
writeFileSync(path.join(dir, "raw/edl.json"), JSON.stringify({ title: script.title, items }, null, 2));
console.log(`장면 ${items.length}개, 길이 ${Math.floor(total / 60)}분 ${Math.round(total % 60)}초`);
for (const it of items.filter((i) => (i.rate ?? 1) > 1.15)) console.log(`  빠르게 감기: ${it.id} ×${it.rate.toFixed(1)}`);
if (total > 295) throw new Error("5분을 넘습니다. 대본을 줄이세요.");

// 브라우저는 새로 내려받지 않고 Playwright가 설치해 둔 것을 쓴다.
const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().at(-1);
const found = execFileSync("find", [path.join(cache, shell), "-type", "f", "-name", "*headless*shell*", "-perm", "+111"]).toString().trim().split("\n")[0];
mkdirSync(path.join(dir, "out"), { recursive: true });
const still = process.argv.indexOf("--still");
const common = ["--props=raw/edl.json", `--browser-executable=${found}`, "--log=error"];
const args = still > -1
  ? ["remotion", "still", "src/index.ts", "Demo", `out/frame-${process.argv[still + 1]}.png`, `--frame=${process.argv[still + 1]}`, ...common]
  : ["remotion", "render", "src/index.ts", "Demo", "out/open-receipt-demo.mp4", "--codec=h264", "--crf=20", ...common];
execFileSync("npx", args, { cwd: dir, stdio: "inherit" });
