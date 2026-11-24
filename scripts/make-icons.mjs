// SPDX-License-Identifier: GPL-3.0-or-later
// 앱 아이콘을 만든다: node scripts/make-icons.mjs
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
for (const [size, name] of [[512, "icon-512.png"], [192, "icon-192.png"], [180, "apple-touch-icon.png"]]) {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: size / 512 });
  await page.goto(pathToFileURL(path.join(dir, "icon.html")).href);
  await page.locator(".i").screenshot({ path: path.join(dir, "..", "public", name) });
  await page.close();
}
await browser.close();
