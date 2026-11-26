// SPDX-License-Identifier: GPL-3.0-or-later
/** 시험 페이지는 검색에 나오지 않게 한다. */
export const metadata = { title: "시험 페이지 · 열린영수증", robots: { index: false, follow: false } };

export default function DebugLayout({ children }: { children: React.ReactNode }) {
  return children;
}
