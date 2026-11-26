// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 결산보고서 본문(ReportBody)과 변조 확인용 지문 카드(ProofCard).
 * 앱의 결산보고서 화면, 공유 링크(/r), 후원자용 보기(/v)가 함께 쓴다.
 */
"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useRef, useState } from "react";
import { shortPrint } from "@/lib/ledger";
import { closedLine, spendRate, won, type Report } from "@/lib/report";

const num = (v: string) => <Text hasTabularNumbers textWrap="nowrap">{v}</Text>;
const Note = ({ children }: { children: React.ReactNode }) => <Text type="supporting" color="secondary" display="block">{children}</Text>;
const amountCol = { key: "amount", header: "금액", align: "end" as const, renderCell: (x: { amount: string }) => num(x.amount) };

/** 결산보고서 본문. 앱의 보고서 화면과 공유 링크 화면이 함께 쓴다. */
export function ReportBody({ r, detail = true }: { r: Report; detail?: boolean }) {
  return (
    <>
      {r.closed ? <Banner status="success" title="마감된 결산보고서입니다" description={`${closedLine(r.closed)}. 마감한 뒤에는 이 사업의 기록을 고칠 수 없습니다.`} data-testid="report-closed" /> : null}
      <Heading level={2}>1. 요약</Heading>
      <VStack className="scroll-x wide-table">
        <Table
          idKey="id"
          data={[{ id: "sum", count: `${r.count}건`, total: won(r.total), approved: won(r.approvedTotal), open: `${r.openItems.length}건`, reimb: won(r.reimbursementTotal) }]}
          columns={[
            { key: "count", header: "지출 건수", align: "end" },
            { key: "total", header: "지출 합계", align: "end", renderCell: (x) => <Text id="report-total" hasTabularNumbers weight="semibold" textWrap="nowrap">{x.total}</Text> },
            { key: "approved", header: "승인 완료 금액", align: "end", renderCell: (x) => num(x.approved) },
            ...(detail ? [{ key: "open" as const, header: "확인할 항목", align: "end" as const }] : []),
            { key: "reimb", header: "환급 필요 금액", align: "end", renderCell: (x) => num(x.reimb) },
          ]}
        />
      </VStack>
      <Heading level={2}>2. 예산 항목별 집행</Heading>
      {r.budgetTotal ? (
        // 예산을 정해 두었으면 쓴 돈을 예산과 견줘 보여 준다. 예산을 넘은 항목도 판정 없이 숫자만 보인다.
        <VStack className="scroll-x wide-table" data-testid="budget-table">
          <Table
            idKey="name"
            data={[
              ...r.byCategory.map((g) => ({ name: g.name, count: `${g.count}건`, amount: won(g.amount), budget: g.budget ? won(g.budget) : "-", rate: spendRate(g.amount, g.budget) || "-", left: g.budget ? won(g.budget - g.amount) : "-" })),
              { name: "합계", count: `${r.count}건`, amount: won(r.total), budget: won(r.budgetTotal), rate: spendRate(r.total, r.budgetTotal), left: won(r.budgetTotal - r.total) },
            ]}
            columns={[
              { key: "name", header: "예산 항목" }, { key: "count", header: "건수", align: "end" }, { key: "amount", header: "쓴 금액", align: "end", renderCell: (x) => num(x.amount) },
              { key: "budget", header: "예산", align: "end", renderCell: (x) => num(x.budget) }, { key: "rate", header: "집행률", align: "end", renderCell: (x) => num(x.rate) }, { key: "left", header: "남은 금액", align: "end", renderCell: (x) => num(x.left) },
            ]}
          />
        </VStack>
      ) : (
        <Table
          idKey="name"
          data={[...r.byCategory.map((g) => ({ name: g.name, count: `${g.count}건`, amount: won(g.amount) })), { name: "합계", count: `${r.count}건`, amount: won(r.total) }]}
          columns={[{ key: "name", header: "예산 항목" }, { key: "count", header: "건수", align: "end" }, amountCol]}
        />
      )}
      <Heading level={2}>3. 결제 방식별 집행</Heading>
      <Table
        idKey="name"
        data={r.byPayment.map((g) => ({ name: g.name, count: `${g.count}건`, amount: won(g.amount) }))}
        columns={[{ key: "name", header: "결제 방식" }, { key: "count", header: "건수", align: "end" }, amountCol]}
      />
      {detail ? <>
        <Heading level={2}>4. 지출 내역</Heading>
        <VStack className="scroll-x wide-table">
          <Table
            idKey="id"
            density="compact"
            verticalAlign="top"
            data={r.rows.map((x, i) => ({ ...x, id: String(i), amountText: won(x.amount) }))}
            columns={[
              { key: "date", header: "날짜", renderCell: (x) => num(x.date) }, { key: "item", header: "항목" }, { key: "amountText", header: "금액", align: "end", renderCell: (x) => num(x.amountText) },
              { key: "budgetCategory", header: "예산 항목" }, { key: "payment", header: "결제" }, { key: "evidence", header: "증빙" },
              { key: "status", header: "상태" }, { key: "summary", header: "내용" },
            ]}
          />
        </VStack>
        <Heading level={2}>5. 제출 전 확인할 항목</Heading>
        <Table
          idKey="id"
          emptyState={<Note>확인할 항목이 없습니다.</Note>}
          data={r.openItems.map((o, i) => ({ id: String(i), item: o.item, amount: won(o.amount), text: o.text }))}
          columns={[{ key: "item", header: "항목" }, amountCol, { key: "text", header: "다음 행동" }]}
        />
        <Heading level={2}>6. 환급 대상</Heading>
        <Table
          idKey="id"
          emptyState={<Note>환급 대상이 없습니다.</Note>}
          data={r.reimbursements.map((x, i) => ({ id: String(i), payer: x.payer, item: x.item, amount: won(x.amount), approved: x.approved ? "승인 완료" : "승인 전" }))}
          columns={[{ key: "payer", header: "결제자" }, { key: "item", header: "항목" }, amountCol, { key: "approved", header: "승인" }]}
        />
      </> : null}
      <Heading level={2}>{detail ? "7. 참고한 공개 지침" : "4. 참고한 공개 지침"}</Heading>
      {r.sources.length === 0 ? <Note>연결된 출처가 없습니다.</Note> : (
        <List hasDividers edge="flush">
          {r.sources.map((s) => (
            <ListItem key={s.url} label={<Text>{s.title}</Text>} description={`${s.date ?? "날짜 미상"} · 검색 ${s.searchedAt.slice(0, 10)}`}
              endContent={<Button label="원문 열기" tooltip={s.title} size="sm" variant="ghost" href={s.url} target="_blank" rel="noreferrer" />} />
          ))}
        </List>
      )}
      <HStack gap={6} paddingBlockStart={6}>
        <VStack width="100%"><Text type="supporting" color="secondary">작성자 (총무·재정 담당)</Text></VStack>
        <VStack width="100%"><Text type="supporting" color="secondary">확인자 (대표·승인자)</Text></VStack>
      </HStack>
      <Note>이 문서는 초안입니다. 지출의 적정성 판단과 최종 승인·제출은 조직의 담당자가 합니다.</Note>
    </>
  );
}

/**
 * 받은 사람이 보는 변조 확인용 지문. 지난번에 본 지문을 이 브라우저에 기억해 두었다가,
 * 다시 열었을 때 달라졌으면 알려 준다 (remember를 주었을 때).
 */
export function ProofCard({ fingerprint, ledger, remember }: { fingerprint: string; ledger?: { head: string; devices: number; entries: number }; remember?: string }) {
  const [seen, setSeen] = useState<{ print: string; at: string } | null>(null);
  const handled = useRef("");
  useEffect(() => {
    if (!remember || handled.current === `${remember}:${fingerprint}`) return;
    handled.current = `${remember}:${fingerprint}`; // 같은 지문을 두 번 처리하면 방금 저장한 값과 견주게 된다
    const key = `open-receipt:seen:${remember}`;
    try {
      const old = JSON.parse(window.localStorage.getItem(key) ?? "null");
      setSeen(old && typeof old.print === "string" && old.print !== fingerprint ? old : null);
      window.localStorage.setItem(key, JSON.stringify({ print: fingerprint, at: new Date().toISOString() }));
    } catch { /* 저장소를 쓸 수 없으면 견주지 않는다 */ }
  }, [remember, fingerprint]);
  return (
    <VStack gap={2} data-testid="proof">
      <Heading level={2}>변조 확인용 지문</Heading>
      {seen ? <Banner status="warning" data-testid="proof-changed" title="지난번에 보신 뒤 이 보고서의 기록이 바뀌었습니다" description={`${seen.at.slice(0, 10)}에 보신 지문은 ${shortPrint(seen.print)}였습니다. 무엇이 바뀌었는지 단체에 물어보실 수 있습니다.`} /> : null}
      <List hasDividers edge="flush" density="compact">
        <ListItem label={<Text color="secondary">보고서 지문</Text>} endContent={<Text id="report-print" hasTabularNumbers weight="semibold">{shortPrint(fingerprint)}</Text>} />
        {ledger ? <ListItem label={<Text color="secondary">원장 지문</Text>} endContent={<Text hasTabularNumbers>{shortPrint(ledger.head)}</Text>} /> : null}
        {ledger ? <ListItem label={<Text color="secondary">서명</Text>} endContent={<Text>{`${ledger.entries}줄 · 기기 ${ledger.devices}대`}</Text>} /> : null}
      </List>
      <Note>보고서 지문은 이 사업의 기록이 하나라도 바뀌면 달라집니다. 단체가 알려 준 지문과 같은지 견줘 보세요. 지문은 기록이 바뀌지 않았다는 것을 보여 주며, 기록 내용이 사실인지를 증명하지는 않습니다.</Note>
    </VStack>
  );
}
