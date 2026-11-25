// SPDX-License-Identifier: GPL-3.0-or-later
// 대본(script.json)의 문장마다 내레이션 음성을 만들고 길이를 잰다. macOS의 say와 ffmpeg를 쓴다.
//   node video/tts.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const script = JSON.parse(readFileSync(path.join(dir, "script.json"), "utf8"));
const out = path.join(dir, "public", "audio");
mkdirSync(out, { recursive: true });
const durations = {};
for (const s of script.segments) {
  const aiff = path.join(out, `${s.id}.aiff`), wav = path.join(out, `${s.id}.wav`);
  execFileSync("say", ["-v", script.voice, "-r", "190", "-o", aiff, s.text]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "44100", "-ac", "1", wav]);
  rmSync(aiff);
  durations[s.id] = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString().trim());
}
writeFileSync(path.join(dir, "raw", "durations.json"), JSON.stringify(durations, null, 2));
const total = Object.values(durations).reduce((a, b) => a + b, 0);
console.log(`문장 ${script.segments.length}개, 내레이션 합계 ${total.toFixed(1)}초`);
