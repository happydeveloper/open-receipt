// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Liner Search 결과를 화면과 보고서에 쓰는 출처(Source) 형식으로 바꾼다.
 */
import type { SearchResult } from "./liner";
import type { Source } from "./types";

/** Liner Search 결과를 출처 목록으로 다듬는다. 주소가 없거나 겹치는 것은 뺀다. */
export function toSources(results: SearchResult[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const r of results) {
    if (!r?.url || !/^https?:\/\//.test(r.url) || seen.has(r.url)) continue;
    seen.add(r.url);
    let hostname = r.hostname ?? "";
    if (!hostname) {
      try {
        hostname = new URL(r.url).hostname;
      } catch {}
    }
    out.push({
      title: (r.title ?? "").trim() || hostname,
      url: r.url,
      hostname,
      date: r.date && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : null,
      description: (r.description ?? "").trim(),
    });
  }
  return out;
}
