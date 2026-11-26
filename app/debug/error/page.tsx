// SPDX-License-Identifier: GPL-3.0-or-later
"use client";
/**
 * 오류 화면과 오류 수집이 동작하는지 확인하는 시험 페이지. 단추를 누르면 일부러 오류를 낸다.
 * 어디에서도 이 페이지로 연결하지 않는다. 배포한 뒤 한 번 눌러 보고 수집 도구에 들어왔는지 본다.
 */
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

export default function ErrorTestPage() {
  const [boom, setBoom] = useState(false);
  if (boom) throw new Error("열린영수증 오류 화면 시험 (일부러 낸 오류)");
  return (
    <VStack as="main" className="app" gap={4} padding={4} maxWidth={480}>
      <VStack gap={2}>
        <Heading level={1}>오류 화면 시험</Heading>
        <Text>아래 단추를 누르면 일부러 오류를 냅니다. 오류 화면이 나오고, 오류 수집이 켜져 있으면 한 건이 기록됩니다. 저장된 기록은 건드리지 않습니다.</Text>
      </VStack>
      <Button label="일부러 오류 내기" variant="destructive" width="100%" onClick={() => setBoom(true)} />
      <Button label="앱으로 돌아가기" variant="ghost" href="/app" />
    </VStack>
  );
}
