// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 공유받은 결산보고서 (/r#...). 보고서 내용은 주소의 # 뒤에 압축되어 있어 서버를 거치지 않는다(lib/share.ts).
 */
"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useState } from "react";
import { decodeShare, type SharedReport } from "@/lib/share";
import { ProofCard, ReportBody } from "../report-view";

/** 공유 링크로 연 결산보고서 (읽기 전용). 내용은 링크의 # 뒤에 담겨 있고 서버에는 저장되지 않는다. */
export default function SharedReportPage() {
  const [data, setData] = useState<SharedReport | null | undefined>(undefined);
  useEffect(() => {
    const read = () => decodeShare(window.location.hash).then(setData);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  return (
    <VStack as="main" className="app" gap={0} maxWidth={900}>
      <HStack as="header" className="app-bar" justify="between" align="center" paddingInline={4} paddingBlock={3} gap={2}>
        <Heading level={1}>{data ? `${data.report.project} 결산보고서` : "결산보고서"}</Heading>
        <Text type="supporting" color="secondary">열린영수증</Text>
      </HStack>
      <VStack gap={4} padding={4} className="grow">
        {data === undefined ? <Text color="secondary">불러오는 중…</Text> : null}
        {data === null ? (
          <EmptyState title="보고서를 열 수 없습니다" description="링크가 잘렸거나 형식이 맞지 않습니다. 보낸 분께 링크를 다시 받아 주세요."
            actions={<Button label="열린영수증 열기" href="/app" />} />
        ) : null}
        {data ? <>
          <Banner status="info" title={`${data.org || "단체"}에서 공유한 보고서 초안입니다.`}
            description={`공유일 ${data.sharedAt.slice(0, 10)} · 지출 기간 ${data.report.period} · ${data.options.includeRows ? "지출 내역 포함" : "요약만"}${data.options.showNames ? "" : " · 이름 가림"}. 읽기 전용이며 최신 내용이 아닐 수 있습니다.`} />
          <ReportBody r={data.report} detail={data.options.includeRows} />
          {data.proof ? <ProofCard fingerprint={data.proof.fingerprint} ledger={data.proof.ledger} /> : null}
          <HStack gap={2} className="noprint">
            <Button label="인쇄" width="100%" onClick={() => window.print()} />
            <Button label="열린영수증 알아보기" width="100%" href="/" />
          </HStack>
        </> : null}
      </VStack>
    </VStack>
  );
}
