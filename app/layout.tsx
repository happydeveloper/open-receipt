// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 모든 페이지의 바탕 틀. 글꼴·테마 스타일과 한국어 설정을 건다.
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "열린영수증",
  description: "영수증을 올리면 에이전트가 증빙 묶음을 완성합니다",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "열린영수증", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#16191d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
