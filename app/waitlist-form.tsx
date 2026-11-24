// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 소개 페이지의 출시 알림 신청·취소 양식. 서버 쪽은 lib/waitlist.ts.
 */
"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";

type State = "idle" | "sending" | "joined" | "left";

/** 정식 출시 알림 신청. 이메일은 출시 안내에만 쓰고, 언제든 취소(삭제)할 수 있다. */
export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [org, setOrg] = useState("");
  const [use, setUse] = useState("");
  const [website, setWebsite] = useState(""); // 사람에게는 보이지 않는 칸 (자동 프로그램 거르기)
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [err, setErr] = useState("");

  async function send(method: "POST" | "DELETE") {
    setErr("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setErr("이메일 주소를 확인해 주세요. 예: name@example.com");
    if (method === "POST" && !consent) return setErr("이메일 수집·이용에 동의해 주세요.");
    setState("sending");
    try {
      const res = await fetch("/api/waitlist", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, org, use, consent, website }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(body.error || "등록하지 못했습니다. 잠시 후 다시 시도해 주세요."); return setState("idle"); }
      setState(method === "POST" ? "joined" : "left");
    } catch {
      setErr("네트워크에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setState("idle");
    }
  }

  if (state === "joined") {
    return (
      <VStack gap={3} data-testid="waitlist-done">
        <Banner status="success" title="신청되었습니다." description={`정식으로 출시하면 ${email.trim()} 주소로 안내 메일을 보내 드리겠습니다.`} />
        <Button label="신청 취소 (이메일 삭제)" variant="ghost" onClick={() => send("DELETE")} />
      </VStack>
    );
  }
  if (state === "left") {
    return <Banner status="info" title="신청을 취소했습니다." description="저장된 이메일을 삭제했습니다." />;
  }
  return (
    <VStack as="form" gap={3} onSubmit={(e: React.FormEvent) => { e.preventDefault(); send("POST"); }}>
      {err ? <Banner status="error" title={err} /> : null}
      <TextInput id="wl-email" type="email" label="이메일" value={email} placeholder="name@example.com" autoComplete="email" onChange={setEmail} />
      <TextInput id="wl-org" label="단체 이름 (선택)" value={org} placeholder="예: 다온 나눔모임" onChange={setOrg} />
      <TextInput id="wl-use" label="어떤 일에 쓰고 싶으신가요? (선택)" value={use} placeholder="예: 행사 뒤 정산, 연말 후원자 보고" onChange={setUse} />
      <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
      <CheckboxInput id="wl-consent" label="정식 출시 안내를 받기 위한 이메일 수집·이용에 동의합니다" value={consent} onChange={setConsent} />
      <Text type="supporting" color="secondary" display="block">
        수집 항목은 이메일(필수), 단체 이름과 용도(선택)입니다. 정식 출시 안내 메일을 보내는 데에만 쓰고, 광고를 보내거나 다른 곳에 넘기지 않습니다. 안내를 보낸 뒤 삭제하며, 그 전에도 이 페이지에서 같은 이메일로 신청을 취소하면 바로 삭제합니다.
      </Text>
      <Button type="submit" label={state === "sending" ? "신청하는 중…" : "출시 알림 신청"} variant="primary" size="lg" isDisabled={state === "sending"} />
      <Button label="이미 신청했다면: 신청 취소" variant="ghost" isDisabled={state === "sending"} onClick={() => send("DELETE")} />
    </VStack>
  );
}
