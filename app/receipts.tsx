// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 영수증 사진 목록. 앱의 결산보고서와 후원자용 보기가 함께 쓴다.
 * 원본이 있으면 "가린 사진 / 원본"을 바꿔 볼 수 있다(등록자·승인자만 원본을 받는다).
 */
"use client";

import { Card } from "@astryxdesign/core/Card";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useState } from "react";

export interface ReceiptItem {
  id: string;
  caption: string;
  /** 가린 사진. 바로 있으면 문자열, 받아 와야 하면 함수. */
  masked: string | (() => Promise<string | null>);
  /** 원본을 볼 수 있는 사람(등록자·승인자)에게만 준다. 후원자용 보기에는 없다. */
  loadOriginal?: () => Promise<string | null>;
}

function Receipt({ item }: { item: ReceiptItem }) {
  const [mode, setMode] = useState<"masked" | "original">("masked");
  const [masked, setMasked] = useState<string | null | undefined>(typeof item.masked === "string" ? item.masked : undefined);
  const [original, setOriginal] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (typeof item.masked === "string") return setMasked(item.masked);
    let alive = true;
    item.masked().then((v) => alive && setMasked(v));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);
  useEffect(() => {
    if (mode !== "original" || original !== undefined || !item.loadOriginal) return;
    let alive = true;
    item.loadOriginal().then((v) => alive && setOriginal(v));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const src = mode === "original" ? original : masked;
  return (
    <Card padding={3} data-testid="receipt">
      <VStack gap={2}>
        <Text weight="semibold" hasTabularNumbers>{item.caption}</Text>
        {item.loadOriginal ? (
          <SegmentedControl label={`${item.caption} 사진 종류`} layout="fill" size="sm" value={mode} onChange={(v) => setMode(v === "original" ? "original" : "masked")}>
            <SegmentedControlItem value="masked" label="가린 사진" />
            <SegmentedControlItem value="original" label="원본" />
          </SegmentedControl>
        ) : null}
        {src ? (
          <VStack className="maskwrap static"><img src={src} alt={`${item.caption} ${mode === "original" ? "원본 영수증" : "가린 영수증"}`} loading="lazy" /></VStack>
        ) : (
          <Text type="supporting" color="secondary">
            {src === undefined ? "사진을 불러오는 중…" : mode === "original" ? "이 기기에는 원본이 없습니다. 원본은 올린 기기와 단체 공간 구성원의 기기에만 있습니다." : "사진을 불러오지 못했습니다."}
          </Text>
        )}
      </VStack>
    </Card>
  );
}

/** 영수증 모아 보기. 결산보고서, 기록 상세, 후원자용 보기가 함께 쓴다. */
export function ReceiptGallery({ items }: { items: ReceiptItem[] }) {
  if (items.length === 0) return <Text type="supporting" color="secondary">첨부된 영수증 사진이 없습니다.</Text>;
  return <VStack gap={3} className="receipt-grid">{items.map((it) => <Receipt key={it.id} item={it} />)}</VStack>;
}
