// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 브라우저 테스트 설정. BASE_URL을 주면 그 주소(배포본)를, 없으면 개발 서버를 띄워 대상으로 삼는다.
 * 화면 크기는 휴대폰 기준이다.
 */
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: process.env.BASE_URL || "http://localhost:3210", viewport: { width: 390, height: 844 }, locale: "ko-KR" },
  // BASE_URL을 주면 배포된 주소를 대상으로 돌린다 (로컬 서버를 띄우지 않음).
  webServer: process.env.BASE_URL ? undefined : { command: "npx next dev -p 3210", url: "http://localhost:3210", reuseExistingServer: true, timeout: 120_000 },
});
