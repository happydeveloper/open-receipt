// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 단위 테스트 설정. tests/ 아래만 돌리고, "@/"를 저장소 루트로 푼다.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname) } },
});
