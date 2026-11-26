// SPDX-License-Identifier: GPL-3.0-or-later
import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // 모든 응답에 보안 헤더를 붙인다. 오류 수집 도구를 붙였다면 그 주소를 connect에 넣는다 (lib/security-headers.ts).
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders({ dev: process.env.NODE_ENV !== "production" }) }];
  },
};

export default nextConfig;
