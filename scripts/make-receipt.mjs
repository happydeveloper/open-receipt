// SPDX-License-Identifier: GPL-3.0-or-later
// 가상 영수증 HTML을 PNG로 렌더링한다: node scripts/make-receipt.mjs
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 1.5 });
await page.goto(pathToFileURL(path.join(dir, "demo-receipt.html")).href);
await page.locator(".r").screenshot({ path: path.join(dir, "..", "public", "demo-receipt.png") });
await browser.close();
