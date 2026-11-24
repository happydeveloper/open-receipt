// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Astryx 디자인 시스템의 한국어 문구와 neutral 테마를 모든 화면에 공급한다.
 */
"use client";

import { InternationalizationProvider } from "@astryxdesign/core/i18n";
import koKR from "@astryxdesign/core/locales/ko-KR.generated.js";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

/** Astryx 테마와 한국어 문구(달력, 선택 안내 등)를 앱 전체에 적용한다. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <InternationalizationProvider locale="ko-KR" messages={{ "ko-KR": koKR }}>
      <Theme theme={neutralTheme}>{children}</Theme>
    </InternationalizationProvider>
  );
}
