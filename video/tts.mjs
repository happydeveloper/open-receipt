// SPDX-License-Identifier: GPL-3.0-or-later
// 대본(script.json)의 문장마다 내레이션 음성을 만들고 길이를 잰다.
//   node video/tts.mjs
// script.json의 voice가 "ko-KR-"로 시작하면 Microsoft 신경망 음성(edge-tts)을 쓴다. 이때 대본 문장이
// Microsoft 서버로 전송된다. edge-tts는 `pip install edge-tts`로 설치하고, 실행 파일 위치를 EDGE_TTS로 알려 준다.
// 그 밖의 이름이면 macOS에 설치된 음성(say)을 쓴다. 외부로 보내는 것은 없다.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const dir = path.dirname(new URL(import.meta.url).pathname);
const script = JSON.parse(readFileSync(path.join(dir, "script.json"), "utf8"));
const out = path.join(dir, "public", "audio");
mkdirSync(out, { recursive: true });
const cache = path.join(dir, "raw", "tts-cache");
mkdirSync(cache, { recursive: true });
const durations = {};
for (const s of script.segments) {
  const wav = path.join(out, `${s.id}.wav`);
  const neural = script.voice.startsWith("ko-KR-");
  // 만든 음성은 문장별로 보관해 두고, 문장이 그대로면 다시 만들지 않는다 (서버가 가끔 멈추므로 이어서 만들 수 있게).
  const key = createHash("sha1").update(`${script.voice}|${script.rate ?? ""}|${s.text}`).digest("hex").slice(0, 12);
  const tmp = path.join(cache, `${s.id}-${key}.${neural ? "mp3" : "aiff"}`);
  if (!existsSync(tmp) || statSync(tmp).size === 0) {
    for (let attempt = 1; ; attempt++) {
      try {
        if (neural) execFileSync(process.env.EDGE_TTS || "edge-tts", ["--voice", script.voice, "--rate", script.rate || "+0%", "--text", s.text, "--write-media", tmp], { stdio: "ignore", timeout: 40_000 });
        else execFileSync("say", ["-v", script.voice, "-r", "190", "-o", tmp, s.text]);
        if (statSync(tmp).size > 0) break;
      } catch { /* 아래에서 다시 시도 */ }
      if (attempt >= 5) throw new Error(`${s.id}: 음성을 만들지 못했습니다. 잠시 뒤 다시 실행하세요.`);
      console.log(`  ${s.id}: 다시 시도 (${attempt})`);
    }
  }
  // 앞뒤의 긴 무음은 잘라 내고, 소리 크기를 고르게 맞춘다.
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", tmp, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1.5", "-ar", "44100", "-ac", "1", wav]);
  durations[s.id] = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString().trim());
}
writeFileSync(path.join(dir, "raw", "durations.json"), JSON.stringify(durations, null, 2));
const total = Object.values(durations).reduce((a, b) => a + b, 0);
console.log(`문장 ${script.segments.length}개, 내레이션 합계 ${total.toFixed(1)}초`);
