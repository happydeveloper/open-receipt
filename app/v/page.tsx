// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 후원자용 보기 (/v#...). 단체 공간에서 후원자 열쇠로 암호화해 올린 결산보고서와 가린 영수증을
 * 읽기 전용으로 보여 준다. 열쇠는 주소의 # 뒤에 있어 서버로 가지 않는다(lib/sponsor-view.ts, lib/sync-crypto.ts).
 */
"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useState } from "react";
import { won } from "@/lib/report";
import type { ViewBundle } from "@/lib/sponsor-view";
import { decryptText, parseViewCode, type Workspace } from "@/lib/sync-crypto";
import { ReceiptGallery } from "../receipts";
import { ProofCard, ReportBody } from "../report-view";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; bundle: ViewBundle; viewer: Workspace };

/**
 * 후원자용 보기 (읽기 전용). 결산보고서와 가린 영수증만 보인다.
 * 열쇠는 링크의 # 뒤에 있어 서버로 가지 않고, 이 열쇠로는 원본이나 기록을 열 수 없다.
 */
export default function SponsorViewPage() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [project, setProject] = useState("");

  async function read() {
    const viewer = parseViewCode(window.location.hash);
    if (!viewer) return setLoad({ state: "error", message: "링크가 잘렸거나 형식이 맞지 않습니다. 보낸 분께 링크를 다시 받아 주세요." });
    try {
      const res = await fetch(`/api/sync/${viewer.id}/view`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setLoad({ state: "error", message: res.status === 404 ? "아직 공유된 결산보고서가 없습니다." : body.error || "보고서를 불러오지 못했습니다." });
      const text = await decryptText(viewer, body.data);
      if (!text) return setLoad({ state: "error", message: "이 링크로는 보고서를 열 수 없습니다. 보낸 분께 링크를 다시 받아 주세요." });
      const bundle = JSON.parse(text) as ViewBundle;
      if (bundle.disabled) return setLoad({ state: "error", message: "단체에서 후원자용 보기를 닫았습니다." });
      setLoad({ state: "ok", bundle, viewer });
      setProject((p) => (bundle.projects.some((x) => x.project === p) ? p : bundle.projects[0]?.project ?? ""));
    } catch {
      setLoad({ state: "error", message: "네트워크에 연결하지 못했습니다. 잠시 후 다시 열어 주세요." });
    }
  }
  useEffect(() => { read(); }, []);

  const ok = load.state === "ok" ? load : null;
  const cur = ok?.bundle.projects.find((p) => p.project === project);
  return (
    <VStack as="main" className="app" gap={0} maxWidth={900}>
      <HStack as="header" className="app-bar" justify="between" align="center" paddingInline={4} paddingBlock={3} gap={2}>
        <Heading level={1}>{cur ? `${cur.project} 결산보고서` : "결산보고서"}</Heading>
        <Text type="supporting" color="secondary">{ok ? ok.bundle.org || "열린영수증" : "열린영수증"}</Text>
      </HStack>
      <VStack gap={4} padding={4} className="grow">
        {load.state === "loading" ? <Text color="secondary">불러오는 중…</Text> : null}
        {load.state === "error" ? <EmptyState title="보고서를 열 수 없습니다" description={load.message} actions={<Button label="다시 불러오기" onClick={() => { setLoad({ state: "loading" }); read(); }} />} /> : null}
        {ok ? <>
          <Banner status="info" title={`${ok.bundle.org || "단체"}에서 후원자께 공유한 결산보고서입니다.`}
            description={`${ok.bundle.publishedAt.slice(0, 10)} 기준 · 읽기 전용${ok.bundle.showNames ? "" : " · 이름 가림"}. 영수증은 개인정보를 가린 사진으로 제공됩니다.`} />
          {ok.bundle.projects.length === 0 ? <Text color="secondary">아직 기록된 지출이 없습니다.</Text> : null}
          {ok.bundle.projects.length > 1 ? (
            <Selector id="v-project" label="사업·행사" options={ok.bundle.projects.map((p) => ({ value: p.project, label: `${p.project} (${won(p.report.total)})` }))} value={project} onChange={(v) => v && setProject(v)} />
          ) : null}
          {cur ? <>
            <ReportBody r={cur.report} />
            <Heading level={2}>8. 영수증</Heading>
            <ReceiptGallery
              key={cur.project}
              items={cur.receipts.filter((r) => r.hasImage).flatMap((r) =>
                // 한 지출에 붙은 사진을 모두 보여 준다. 예전에 올린 자료에는 photos가 없어 영수증 한 장으로 본다.
                (r.photos ?? [{ key: r.id, label: "영수증" }]).map((p) => ({
                  id: p.key,
                  caption: `${r.date} · ${r.item} · ${won(r.amount)} · ${p.label}`,
                  masked: async () => {
                    const res = await fetch(`/api/sync/${ok.viewer.id}/img/${encodeURIComponent(p.key)}?kind=view`);
                    if (!res.ok) return null;
                    return decryptText(ok.viewer, (await res.json()).data);
                  },
                })),
              )}
            />
            {cur.fingerprint ? <ProofCard key={cur.project} fingerprint={cur.fingerprint} ledger={ok.bundle.ledger} remember={`${ok.viewer.id}:${cur.project}`} /> : null}
            <HStack gap={2} className="noprint">
              <Button label="인쇄" width="100%" onClick={() => window.print()} />
              <Button label="새로 고침" width="100%" onClick={() => { setLoad({ state: "loading" }); read(); }} />
            </HStack>
          </> : null}
        </> : null}
      </VStack>
    </VStack>
  );
}
