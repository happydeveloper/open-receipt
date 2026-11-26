// SPDX-License-Identifier: GPL-3.0-or-later
"use client";
/** 페이지 안에서 난 오류. 틀(글꼴·테마)은 살아 있으므로 평소와 같은 모양으로 보여 준다. */
import { ErrorScreen } from "./error-screen";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} where="page" />;
}
