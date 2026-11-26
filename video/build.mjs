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
  const base = { id: s.id, kind: s.kind, chapter: s.chapter, role: s.role, text: s.text, audio: `audio/${s.id}.wav`, ...(s.api ? { api: s.api } : {}) };
  if (s.kind === "title") { items.push({ ...base, frames: Math.round((say + 0.9) * FPS) }); continue; }
  const m = timeline.marks.find((x) => x.id === s.id);
  if (!m) { console.log(`건너뜀: ${s.id} (녹화에 없는 장면)`); continue; }
  const natural = (m.to - m.from) / 1000;
  // 말이 끝날 때까지는 보여 주고, 그보다 2.5초 넘게 길면 줄인다.
  const show = Math.max(say + 0.5, Math.min(natural, say + 2.5));
  items.push({ ...base, frames: Math.round(show * FPS), clip: `clips/${m.dev}.mp4`, startSec: m.from / 1000 + LEAD, rate: natural / show });
  // 말이 화면보다 조금 길면 화면을 살짝 느리게 돌려 맞춘다. 많이 길면 다시 녹화해야 한다.
  if (natural / show < 0.8) throw new Error(`${s.id}: 내레이션이 화면보다 너무 깁니다. 녹화를 다시 하세요.`);
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
if (still > -1) {
  execFileSync("npx", ["remotion", "still", "src/index.ts", "Demo", `out/frame-${process.argv[still + 1]}.png`, `--frame=${process.argv[still + 1]}`, ...common], { cwd: dir, stdio: "inherit" });
} else {
  // 한 번에 통째로 인코딩하면 가끔 한 프레임에서 멈춘다. 장면 경계에서 몇 토막으로 나눠 만들고(멈추면 그 토막만 다시),
  // 마지막에 이어 붙인다. 장면 경계는 말이 끝난 자리라 이은 곳이 티 나지 않는다.
  const parts = [];
  let from = 0, at = 0;
  for (const [i, it] of items.entries()) {
    at += it.frames;
    if (at - from >= 20 * FPS || i === items.length - 1) { parts.push([from, at - 1]); from = at; }
  }
  mkdirSync(path.join(dir, "raw/parts"), { recursive: true });
  const names = [];
  for (const [n, [a, b]] of parts.entries()) {
    const file = `raw/parts/part-${String(n).padStart(2, "0")}.mp4`;
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync("npx", ["remotion", "render", "src/index.ts", "Demo", file, `--frames=${a}-${b}`, "--codec=h264", "--crf=20", "--timeout=60000", ...common], { cwd: dir, stdio: "ignore" });
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        console.log(`  토막 ${n} 다시 시도 (${attempt})`);
      }
    }
    console.log(`토막 ${n + 1}/${parts.length} (${a}~${b})`);
    names.push(`file '${path.join(dir, file)}'`);
  }
  writeFileSync(path.join(dir, "raw/parts/list.txt"), names.join("\n"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "raw/parts/list.txt"), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", path.join(dir, "out/open-receipt-demo.mp4")]);
  console.log("완성: out/open-receipt-demo.mp4");
}
