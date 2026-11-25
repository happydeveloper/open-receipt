// SPDX-License-Identifier: GPL-3.0-or-later
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "열린영수증 사용 안내",
  description: "등록자, 승인자, 후원자가 영수증 등록부터 승인, 결산 공유까지 따라 하는 방법",
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return children;
}
