// SPDX-License-Identifier: GPL-3.0-or-later
"use client";
/** 바탕 틀(layout)까지 깨졌을 때. 틀을 대신해야 하므로 html과 body를 직접 그리고, 테마를 다시 건다. */
import "./globals.css";
import { ErrorScreen } from "./error-screen";
import { Providers } from "./providers";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body>
        <Providers><ErrorScreen error={error} reset={reset} where="layout" /></Providers>
      </body>
    </html>
  );
}
