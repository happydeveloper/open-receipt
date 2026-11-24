// SPDX-License-Identifier: GPL-3.0-or-later
import type { MetadataRoute } from "next";

/** 휴대폰 홈 화면에 설치할 수 있게 하는 웹 앱 매니페스트. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "열린영수증",
    short_name: "열린영수증",
    description: "영수증을 올리면 에이전트가 증빙 묶음을 완성합니다",
    lang: "ko",
    start_url: "/app",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#16191d",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
