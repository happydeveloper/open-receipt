// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 브라우저 테스트 설정. BASE_URL을 주면 그 주소(배포본)를, 없으면 개발 서버를 띄워 대상으로 삼는다.
 * 화면 크기는 휴대폰 기준이다.
 */
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // 코드를 고친 뒤 처음 돌릴 때 개발 서버가 화면을 다시 만드느라 테스트 하나가 시간 초과로 실패하는 일이 있다.
  // 로컬에서는 한 번 더 해 본다. 배포본을 대상으로 할 때는 다시 하지 않는다 (실패를 가리지 않도록).
  retries: process.env.BASE_URL ? 0 : 1,
  use: { baseURL: process.env.BASE_URL || "http://localhost:3210", viewport: { width: 390, height: 844 }, locale: "ko-KR" },
  // BASE_URL을 주면 배포된 주소를 대상으로 돌린다 (로컬 서버를 띄우지 않음).
  // 개발 서버는 화면을 처음 열 때 만들기 시작해 오래 걸린다. 앱 화면(/app)이 열릴 때까지 기다렸다가 테스트를 시작한다.
  // 소개 화면(/)만 기다리면 첫 테스트 한두 개가 가끔 시간 초과로 실패했다.
  webServer: process.env.BASE_URL ? undefined : { command: "npx next dev -p 3210", url: "http://localhost:3210/app", reuseExistingServer: true, timeout: 180_000 },
});
