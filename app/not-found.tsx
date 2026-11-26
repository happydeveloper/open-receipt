// SPDX-License-Identifier: GPL-3.0-or-later
/** 없는 주소로 들어왔을 때. */
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

export const metadata = { title: "찾을 수 없는 페이지 · 열린영수증" };

export default function NotFound() {
  return (
    <VStack as="main" className="app" gap={4} padding={4} maxWidth={480} data-testid="not-found">
      <VStack gap={2}>
        <Heading level={1}>찾을 수 없는 페이지입니다</Heading>
        <Text>주소가 바뀌었거나 잘못 입력되었습니다. 받은 링크라면 끝까지 복사되었는지 확인해 주세요.</Text>
      </VStack>
      <Button label="앱 열기" variant="primary" size="lg" width="100%" href="/app" />
      <Button label="사용 안내 보기" size="lg" width="100%" href="/guide" />
      <Button label="소개 페이지로" variant="ghost" href="/" />
    </VStack>
  );
}
