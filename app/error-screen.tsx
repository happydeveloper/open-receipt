// SPDX-License-Identifier: GPL-3.0-or-later
"use client";
/**
 * 오류 화면. 화면을 그리다 오류가 나면 흰 화면 대신 이것을 보여 준다.
 *
 * 사용자가 가장 걱정할 것은 "내 기록이 사라졌나"이므로 그것부터 답한다:
 * 기록은 기기에 그대로 있고, 다시 시도해도 안 열리면 여기서 바로 백업 파일로 꺼낼 수 있다.
 */
import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { hasReporter, reportError } from "@/lib/error-hook";
import { rescueBackup } from "@/lib/rescue";
import { STORAGE_KEY } from "@/lib/storage";

export function ErrorScreen({ error, reset, where }: { error: Error & { digest?: string }; reset: () => void; where: string }) {
  const [note, setNote] = useState("");
  const [hasData, setHasData] = useState(false);
  const [reported, setReported] = useState(false);
  useEffect(() => {
    reportError(error, where);
    setReported(hasReporter());
  }, [error, where]);
  useEffect(() => {
    try { setHasData(!!window.localStorage.getItem(STORAGE_KEY)); } catch { /* 저장소를 읽지 못하면 단추를 숨긴다 */ }
  }, []);

  async function saveBackup() {
    try {
      const back = await rescueBackup(window.localStorage);
      if (!back) return setNote("이 기기에 저장된 기록이 없습니다.");
      const url = URL.createObjectURL(new Blob([back.text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = back.name; a.click();
      URL.revokeObjectURL(url);
      setNote(`백업 파일을 내려받았습니다. 기록 ${back.count}건이 들어 있습니다. 설정의 "백업 가져오기"로 되돌릴 수 있습니다.`);
    } catch {
      setNote("백업 파일을 만들지 못했습니다. 브라우저를 닫지 말고 잠시 뒤 다시 시도해 주세요.");
    }
  }

  return (
    <VStack as="main" className="app" gap={4} padding={4} maxWidth={480} data-testid="error-screen">
      <VStack gap={2}>
        <Heading level={1}>화면을 여는 중 문제가 생겼습니다</Heading>
        <Text>불편을 드려 죄송합니다. 다시 시도하면 대부분 열립니다.</Text>
      </VStack>
      <Banner status="info" title="기록은 이 기기에 그대로 있습니다" description="화면에 문제가 생겼을 뿐, 저장된 지출 기록과 사진은 지워지지 않았습니다." />
      <Button label="다시 시도" variant="primary" size="lg" width="100%" onClick={reset} />
      <Button label="새로 고침" size="lg" width="100%" onClick={() => window.location.reload()} />
      <Button label="소개 페이지로" variant="ghost" href="/" />
      {hasData ? (
        <VStack gap={2}>
          <Heading level={2}>계속 열리지 않으면</Heading>
          <Text type="supporting" color="secondary">이 기기의 기록을 백업 파일로 내려받아 둘 수 있습니다. 다른 브라우저나 기기에서 설정의 "백업 가져오기"로 되돌릴 수 있습니다.</Text>
          <Button label="기록 백업 내려받기" width="100%" onClick={saveBackup} />
        </VStack>
      ) : null}
      {note ? <Banner status="success" title={note} /> : null}
      <Text type="supporting" color="secondary">
        {reported ? "문제가 생긴 사실은 고치는 데 쓰도록 기록됩니다. 영수증과 기록 내용은 보내지 않습니다." : "영수증과 기록 내용은 어디로도 보내지 않습니다."}{error.digest ? ` 오류 번호 ${error.digest}` : ""}
      </Text>
    </VStack>
  );
}
