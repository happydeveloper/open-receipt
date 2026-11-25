// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 앱 본체 (/app). 화면 하나에서 view 값으로 여덟 화면을 바꿔 보여 준다.
 *
 *   intro 첫 방문 소개·단체 공간 참여   list 목록          add 지출 추가(사진 → 가림 → 에이전트 → 확정)
 *   (add 화면의 attach 단계: 이미 있는 지출에 거래명세서 같은 자료를 붙여 한 거래로 묶는다)
 *   bulk  영수증 여러 장 올리기          review 검토·마감   report 결산보고서   detail 기록 상세   settings 설정
 *
 * 이 파일의 구성 (위에서부터):
 *   1. 형식과 상수, AG-UI run 한 번을 돌리는 runOnce, 사진 처리 도우미
 *   2. 화면 부품: Frame, Main, Sub, Stat, Rows, Log, Note (Astryx 부품의 조합)
 *   3. Home 컴포넌트
 *      - 상태: 기록·설정 / 단체 공간 / 여러 장 올리기 / 서명 원장 / 지출 에이전트 / 마감 점검 에이전트
 *      - 시작할 때 저장소에서 불러오기, 동기화(doSync), 저장(persist)
 *      - 지출 추가 흐름: startAdd → pick → startAgent(callAgent) → 질문에 답하기 → confirm
 *      - 그 밖의 동작: approve, runClose(마감 점검), runBulk(여러 장), makeShareLink, createWorkspace·joinWorkspace
 *      - 화면별 그리기: 아래쪽에 "---------- 화면 이름 ----------" 주석으로 나뉘어 있다
 *
 * 규칙은 이 파일에 두지 않는다. 상태 계산은 lib/status.ts, 에이전트 결과 반영은 lib/flow.ts,
 * 동기화는 lib/sync-client.ts, 서명은 lib/ledger.ts에 있고 여기서는 불러 쓰기만 한다.
 *
 * 기록을 바꾸는 모든 경로는 persist를 거친다. persist가 바뀐 기록에 시각을 찍고, 기기에 저장하고,
 * 원장에 서명한 줄을 덧붙인다. 단체 공간과 맞추는 일(doSync)은 기록이 바뀐 것을 본 effect가 맡는다.
 */
"use client";

import { HttpAgent } from "@ag-ui/client";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { DateInput } from "@astryxdesign/core/DateInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";
import { useEffect, useMemo, useRef, useState } from "react";
import { toCsv, totalAmount, sortByDate, evidenceLabel } from "@/lib/csv";
import { applyAgentRecord, editField, fallbackSummary, lockedFields, recordValues } from "@/lib/flow";
import { groupable, mergeGroup, stillValid, toGroupDocs, type GroupProposal } from "@/lib/group";
import { fitWithin, maskText, type Box } from "@/lib/mask";
import { ATTACH_LABELS, newAttachmentId, photoKey, slotsOf } from "@/lib/photos";
import { buildReport, reportPhotos, reportToHtml, won } from "@/lib/report";
import { ReceiptGallery } from "../receipts";
import { ReportBody } from "../report-view";
import { DEMO_PROJECT } from "@/lib/seed";
import { addProject, DEMO_SETTINGS, EMPTY_SETTINGS, loadSettings, makeBackup, missingForStart, parseBackup, saveSettings, SETTINGS_KEY, type Settings } from "@/lib/settings";
import { buildShare, encodeShare, LONG_LINK } from "@/lib/share";
import { appendEntry, auditRecord, createIdentity, diffEntries, loadLedger, members, mergeLedgers, recordsFingerprint, saveLedger, shortPrint, summarize, type Audit, type LedgerState, type LedgerSummary, type Problem } from "@/lib/ledger";
import { EMPTY_META, httpApi, loadMeta, saveMeta, SYNC_KEY, syncNow, type SyncMeta } from "@/lib/sync-client";
import { deviceMasked, deviceOriginals } from "@/lib/originals";
import { inviteCode, newWorkspace, parseInvite, viewCode, viewerWorkspace, type Workspace } from "@/lib/sync-crypto";
import { touchChanged } from "@/lib/sync-merge";
import { approvalBlock, approveExpense, attachEvidence, confirmExpense, detachEvidence, duplicateIds, evidenceMissing, findDuplicates, missingFields, needsAttention, newExpense, openItems, reconfirmExpense, withStatus, type Actor } from "@/lib/status";
import { hydrateImages, loadExpenses, resetToSeed, saveExpenses, STORAGE_KEY } from "@/lib/storage";
import { PAYMENT_LABEL, STATUS_LABEL, type ChecklistItem, type Expense, type PaymentMethod, type Source, type Status } from "@/lib/types";

type View = "intro" | "list" | "add" | "bulk" | "review" | "report" | "detail" | "settings";
interface BulkItem { id: string; name: string; raw: string; boxes: Box[]; state: "ready" | "running" | "done" | "error"; note: string }
type Step = "upload" | "alt" | "mask" | "agent" | "edit" | "saved" | "attach";
type Phase = "idle" | "running" | "ask" | "done" | "error";
interface AgentStep { tool: string; label: string; detail?: string }
interface AgentQuestion { field: string; text: string }
interface CloseResult { briefing: string; requests: { id: string; item: string; amount: number; to: string; message: string }[] }

const MANUAL = "직접 입력으로 계속할 수 있습니다.";
const STATUS_COLOR: Record<Status, "green" | "orange" | "purple" | "gray"> = { done: "green", needs_evidence: "orange", pending_approval: "purple", draft: "gray" };
const PAY_OPTIONS = (Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((p) => ({ value: p, label: PAYMENT_LABEL[p] }));
const ALT_OPTIONS = ["이체확인증", "거래명세서", "사유서", "기타"].map((v) => ({ value: v, label: v }));
const ATTACH_OPTIONS = ATTACH_LABELS.map((v) => ({ value: v, label: v }));

const ASK_USER_TOOL = {
  name: "ask_user",
  description: "에이전트가 스스로 알 수 없는 정보를 사용자에게 묻는다. 화면에 질문 카드를 띄우고 답을 받아 돌려준다.",
  parameters: {
    type: "object",
    properties: { questions: { type: "array", items: { type: "object", properties: { field: { type: "string" }, text: { type: "string" } }, required: ["field", "text"] } } },
    required: ["questions"],
  },
};

/**
 * AG-UI run 한 번. 진행 단계(ACTIVITY_SNAPSHOT)는 오는 대로 화면에 보여 주고,
 * 끝나면 사용자의 답을 기다리는 도구 호출 id 목록을 돌려준다.
 */
async function runOnce(agent: HttpAgent, tools: object[], onStep: (s: AgentStep) => void, context: { description: string; value: string }[] = []): Promise<string[]> {
  let failure = "";
  let pending: string[] = [];
  const timer = setTimeout(() => { failure = `응답이 늦어 중단했습니다. ${MANUAL}`; agent.abortRun(); }, 110_000);
  try {
    await agent.runAgent(
      { tools: tools as any, context },
      {
        onActivitySnapshotEvent: ({ event }) => { const c = event.content as any; if (c?.label) onStep({ tool: String(c.tool ?? ""), label: String(c.label), detail: c.detail ? String(c.detail) : undefined }); },
        onRunErrorEvent: ({ event }) => { failure = event.message; },
        onRunFinishedEvent: (p) => { if (p.outcome === "success") pending = p.pendingToolCallIds; },
      },
    );
  } catch (e: any) {
    if (!failure && /^HTTP 429/.test(String(e?.message))) failure = "요청이 많아 에이전트가 잠시 쉬고 있습니다. 조금 뒤 다시 시도하거나 직접 입력으로 계속해 주세요.";
    if (!failure) failure = e instanceof TypeError ? `네트워크에 연결하지 못했습니다. ${MANUAL}` : `에이전트가 작업을 마치지 못했습니다. ${MANUAL}`;
  } finally {
    clearTimeout(timer);
  }
  if (failure) throw new Error(failure);
  return pending;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("파일을 읽지 못했습니다."));
    r.readAsDataURL(blob);
  });
}

/** 사진을 줄이고 가림 상자를 덮은 JPEG를 만든다. 상자가 없으면 줄이기만 한다(원본 보관용). */
function makeMaskedImage(src: string, boxes: Box[]): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, 1600);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      g.fillStyle = "#000";
      for (const b of boxes) g.fillRect(Math.floor(b.x * w), Math.floor(b.y * h), Math.ceil(b.w * w), Math.ceil(b.h * h));
      res(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => rej(new Error("이미지를 열지 못했습니다. 다른 사진을 선택해 주세요."));
    img.src = src;
  });
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const md = (d: string) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "날짜 없음");

/* ---------- 화면 부품 (Astryx 컴포넌트 조합) ---------- */

function Frame({ title, side, wide, children }: { title: string; side?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <VStack as="main" className="app" gap={0} maxWidth={wide ? 900 : 480}>
      <HStack as="header" className="app-bar" justify="between" align="center" paddingInline={4} paddingBlock={3} gap={2}>
        <Heading level={1}>{title}</Heading>
        {side ? <Text type="supporting" color="secondary">{side}</Text> : null}
      </HStack>
      <VStack gap={4} padding={4} className="grow">{children}</VStack>
    </VStack>
  );
}

function Main({ label, onClick, isDisabled }: { label: string; onClick: () => void; isDisabled?: boolean }) {
  return <Button label={label} variant="primary" size="lg" width="100%" onClick={onClick} isDisabled={isDisabled} />;
}
function Sub({ label, onClick, isDisabled }: { label: string; onClick: () => void; isDisabled?: boolean }) {
  return <Button label={label} variant="secondary" width="100%" onClick={onClick} isDisabled={isDisabled} />;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card padding={3} width="100%">
      <VStack gap={0.5}>
        <Text type="supporting" color="secondary">{label}</Text>
        <Text size="lg" weight="semibold" hasTabularNumbers>{value}</Text>
      </VStack>
    </Card>
  );
}
function Rows({ items, onOpen, dup }: { items: Expense[]; onOpen?: (e: Expense) => void; dup?: Set<string> }) {
  return (
    <List hasDividers edge="flush">
      {items.map((e) => (
        <ListItem
          key={e.id}
          onClick={onOpen ? () => onOpen(e) : undefined}
          label={e.item || "항목 미입력"}
          description={`${md(e.date)} · ${e.paymentMethod ? PAYMENT_LABEL[e.paymentMethod] : "결제 미입력"}${dup?.has(e.id) ? " · 중복 확인" : ""}`}
          endContent={
            <HStack gap={2} align="center">
              <Text hasTabularNumbers>{won(e.amount ?? 0)}</Text>
              <Token label={STATUS_LABEL[e.status]} color={STATUS_COLOR[e.status]} size="sm" />
            </HStack>
          }
        />
      ))}
    </List>
  );
}
function Log({ items, running }: { items: AgentStep[]; running: boolean }) {
  return (
    <ol className="log" aria-live="polite" aria-label="에이전트가 한 일">
      {items.map((s, i) => (
        <li key={i}>
          <Text weight="medium">{s.label}</Text>
          {s.detail ? <Text type="supporting" color="secondary">{s.detail}</Text> : null}
        </li>
      ))}
      {running ? <li className="run"><Text color="secondary">다음 할 일을 정하는 중…</Text></li> : null}
    </ol>
  );
}
function Note({ children }: { children: React.ReactNode }) {
  return <Text type="supporting" color="secondary" display="block">{children}</Text>;
}

export default function Home() {
  const [list, setList] = useState<Expense[]>([]);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("list");
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [draft, setDraft] = useState({ org: "", submitter: "", approver: "", project: "", funder: "" });
  const [newProject, setNewProject] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [share, setShare] = useState({ rows: "rows", names: "hide", link: "", note: "" });
  const importRef = useRef<HTMLInputElement>(null);
  // 단체 공간 (기기 간 공유)
  const [meta, setMeta] = useState<SyncMeta>(EMPTY_META);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState("");
  const [joinWs, setJoinWs] = useState<Workspace | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [viewerLink, setViewerLink] = useState("");
  // 여러 장 한꺼번에 올리기
  const [bulk, setBulk] = useState<BulkItem[]>([]);
  const [bulkMemo, setBulkMemo] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMask, setBulkMask] = useState<string | null>(null);
  const bulkRef = useRef<HTMLInputElement>(null);
  /**
   * 지금 값의 거울. 동기화와 서명은 비동기로 돌아서, 끝날 때쯤이면 화면 상태(state)가 이미 바뀌어 있을 수 있다.
   * 그래서 비동기 코드는 state 대신 항상 최신 값이 들어 있는 live.current를 읽는다.
   */
  const live = useRef({ list: [] as Expense[], settings: EMPTY_SETTINGS, meta: EMPTY_META, busy: false, noteIsError: false, again: null as null | { quiet: boolean }, led: { me: null, ledger: {} } as LedgerState });
  // 서명 원장: 이 기기의 열쇠와, 모든 기기 원장의 사본
  const [led, setLed] = useState<LedgerState>({ me: null, ledger: {} });
  const [ledProblems, setLedProblems] = useState<Problem[]>([]);
  const [audits, setAudits] = useState<Record<string, Audit>>({});
  const [ledSum, setLedSum] = useState<LedgerSummary | null>(null);
  const [reportPrint, setReportPrint] = useState("");
  const ledQueue = useRef<Promise<void>>(Promise.resolve());
  /** 원장을 바꾸는 일은 한 줄로 세워 차례로 한다 (서명과 동기화가 서로 덮어쓰지 않게). */
  const withLedger = (fn: (st: LedgerState) => Promise<LedgerState>) => {
    ledQueue.current = ledQueue.current.then(async () => {
      const next = await fn(live.current.led);
      live.current.led = next; setLed(next); saveLedger(window.localStorage, next);
    }).catch(() => { /* 서명하지 못해도 기록은 저장되어 있다. 화면의 서명 표시로 드러난다. */ });
    return ledQueue.current;
  };
  /** 기록이 바뀐 만큼 이 기기의 원장에 서명해 덧붙인다. 열쇠가 없으면 이때 만든다. */
  const signChanges = (prev: Expense[], next: Expense[]) => withLedger(async (st) => {
    const inputs = await diffEntries(prev, next);
    if (!inputs.length) return st;
    const me = st.me ?? await createIdentity();
    const who = { name: live.current.settings.submitter.trim(), role: live.current.settings.role === "approver" ? "approver" as const : "submitter" as const };
    let ledger = st.ledger;
    for (const input of inputs) ledger = await appendEntry(ledger, me, who, input);
    return { me, ledger };
  });
  const [syncCount, setSyncCount] = useState(0);
  const [project, setProject] = useState(DEMO_PROJECT);
  const [step, setStep] = useState<Step>("upload");
  const [cur, setCur] = useState<Expense>(() => newExpense({ id: "blank" }));
  const [editing, setEditing] = useState(false);
  const [memo, setMemo] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  // 지출에 함께 묶을 자료의 종류 (attach 단계)
  const [attLabel, setAttLabel] = useState(ATTACH_LABELS[0]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  // 지출 에이전트
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [questions, setQuestions] = useState<AgentQuestion[]>([]);
  const agentRef = useRef<HttpAgent | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [guide, setGuide] = useState<{ checklist: ChecklistItem[]; sources: Source[] }>({ checklist: [], sources: [] });
  // 마감 점검 에이전트
  const [closePhase, setClosePhase] = useState<Phase>("idle");
  const [closeSteps, setCloseSteps] = useState<AgentStep[]>([]);
  const [closeOut, setCloseOut] = useState<CloseResult | null>(null);
  const [closeErr, setCloseErr] = useState("");
  const [copied, setCopied] = useState("");
  // 묶음 에이전트: 같은 거래의 서류를 찾아 합치자고 제안한다
  const [groupPhase, setGroupPhase] = useState<Phase>("idle");
  const [groupSteps, setGroupSteps] = useState<AgentStep[]>([]);
  const [groups, setGroups] = useState<GroupProposal[]>([]);
  const [groupNote, setGroupNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [dragBox, setDragBox] = useState<Box | null>(null);

  useEffect(() => {
    const st = loadSettings(window.localStorage);
    const loaded = loadExpenses(window.localStorage) ?? [];
    setSettings(st);
    setList(loaded);
    setMeta(loadMeta(window.localStorage));
    if (st.projects[0]) setProject(st.projects[0]);
    // 초대 링크로 들어왔으면 참여 화면을, 처음 온 사람에게는 소개를 먼저 보여 준다.
    const invite = parseInvite(window.location.hash);
    if (invite) {
      setJoinWs(invite);
      setDraft((d) => ({ ...d, submitter: st.submitter }));
      setView("intro");
    } else if (!st.onboarded && loaded.length === 0) setView("intro");
    // 사진은 큰 보관함에서 불러와 채운 뒤에 화면을 연다.
    hydrateImages(loaded, deviceMasked).then((full) => {
      setList(full); live.current.list = full; live.current.settings = st;
      const kept = loadLedger(window.localStorage);
      live.current.led = kept; setLed(kept);
      // 원장이 생기기 전부터 있던 기록은 이 기기가 지금 내용 그대로 서명해 둔다.
      if (!kept.me && full.length) void signChanges([], full);
      setReady(true);
    });
  }, []);
  live.current.list = list; live.current.settings = settings; live.current.meta = meta;

  const keepMeta = (m: SyncMeta) => { setMeta(m); live.current.meta = m; saveMeta(window.localStorage, m); };
  /** 단체 공간과 맞춘다. 받아서 합치고, 합친 것을 올린다. */
  async function doSync(ws: Workspace | null = live.current.meta.ws, quiet = false) {
    if (!ws) return;
    // 동기화 중에 또 요청이 오면, 끝난 뒤 한 번 더 돌린다 (그 사이의 변경을 놓치지 않도록).
    if (live.current.busy) { live.current.again = { quiet: quiet && (live.current.again?.quiet ?? true) }; return; }
    live.current.busy = true; setSyncing(true);
    try {
      await ledQueue.current; // 방금 바꾼 기록의 서명이 끝난 뒤에 올린다
      const { list: cur, settings: st, meta: m } = live.current;
      const out = await syncNow(ws, {
        expenses: cur, tombstones: m.tombstones, uploaded: m.uploaded, sharedAt: m.sharedAt, ledger: live.current.led.ledger,
        shared: { org: st.org, projects: st.projects, funder: st.funder, approver: st.approver, sponsorView: st.sponsorView, sponsorNames: st.sponsorNames },
      }, httpApi(), undefined, deviceOriginals);
      if (out.changed) {
        setList(out.expenses); live.current.list = out.expenses;
        saveExpenses(window.localStorage, out.expenses, deviceMasked);
        const nextSt: Settings = { ...live.current.settings, ...out.shared, sponsorView: out.shared.sponsorView === true, sponsorNames: out.shared.sponsorNames === true, onboarded: true };
        setSettings(nextSt); live.current.settings = nextSt; saveSettings(window.localStorage, nextSt);
        if (!out.shared.projects.includes(project) && out.shared.projects[0]) setProject(out.shared.projects[0]);
      }
      // 동기화하는 사이에 이 기기가 쓴 줄이 있을 수 있으니, 받은 원장을 지금 사본과 다시 합친다.
      await withLedger(async (cur2) => ({ me: cur2.me, ledger: (await mergeLedgers(cur2.ledger, out.ledger)).ledger }));
      setLedProblems(out.ledgerProblems);
      keepMeta({ ws, version: out.version, uploaded: out.uploaded, tombstones: out.tombstones, sharedAt: out.sharedAt, syncedAt: out.syncedAt });
      // 자동 동기화는 조용히: 앞서 보인 오류만 지우고, 직접 누른 동기화의 안내는 그대로 둔다.
      if (out.missingImages) setSyncNote(`동기화했습니다. 영수증 사진 ${out.missingImages}장은 아직 올라오지 않았습니다.`);
      else if (!quiet) setSyncNote("동기화했습니다.");
      else if (live.current.noteIsError) setSyncNote("");
      live.current.noteIsError = false;
    } catch (e: any) {
      live.current.noteIsError = true;
      setSyncNote(e?.message || "동기화하지 못했습니다. 기록은 이 기기에 그대로 있습니다.");
    } finally {
      live.current.busy = false;
      const again = live.current.again;
      live.current.again = null;
      if (!quiet) setSyncCount((c) => c + 1); // 직접 누른 동기화가 끝났음을 알린다
      if (again) void doSync(undefined, again.quiet);
      else setSyncing(false);
    }
  }
  // 이 기기가 원장에 쓴 줄 수. 줄이 늘면 다른 기기에 전하려고 동기화한다.
  const myLines = led.me ? led.ledger[led.me.key]?.entries.length ?? 0 : 0;
  // 기록을 원장과 견준 결과와 지문. 기록이나 원장이 바뀔 때마다 다시 계산한다.
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, Audit> = {};
      for (const e of list) out[e.id] = await auditRecord(e, led.ledger);
      const sum = await summarize(led.ledger);
      const print = await recordsFingerprint(list.filter((e) => e.project === project));
      if (alive) { setAudits(out); setLedSum(sum); setReportPrint(print); }
    })();
    return () => { alive = false; };
  }, [list, led.ledger, project]);
  // 열 때, 다시 돌아왔을 때, 기록이나 단체 정보가 바뀐 뒤에 자동으로 맞춘다.
  useEffect(() => {
    if (!ready || !meta.ws) return;
    const t = setTimeout(() => doSync(undefined, true), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, meta.ws?.id, list, myLines, settings.org, settings.funder, settings.approver, settings.projects.join("|"), settings.sponsorView, settings.sponsorNames]);
  // 후원자용 보기 링크: 구성원 열쇠에서 한 방향으로 만든 열쇠를 담는다.
  useEffect(() => {
    if (!meta.ws) return setViewerLink("");
    let alive = true;
    viewerWorkspace(meta.ws).then((v) => alive && setViewerLink(`${window.location.origin}/v#${viewCode(v)}`));
    return () => { alive = false; };
  }, [meta.ws?.id, meta.ws?.key]);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") doSync(undefined, true); };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const SUBMITTER = settings.submitter || "담당자";
  // 승인자 기기에서는 이 기기를 쓰는 사람이 승인자다.
  const APPROVER = (settings.role === "approver" ? settings.submitter : settings.approver) || settings.submitter || "승인자";
  const keep = (next: Settings) => {
    const prev = live.current.settings;
    const sharedChanged = prev.org !== next.org || prev.funder !== next.funder || prev.approver !== next.approver || prev.projects.join("|") !== next.projects.join("|") || prev.sponsorView !== next.sponsorView || prev.sponsorNames !== next.sponsorNames;
    setSettings(next); live.current.settings = next; saveSettings(window.localStorage, next);
    if (sharedChanged && live.current.meta.ws) keepMeta({ ...live.current.meta, sharedAt: new Date().toISOString() });
  };
  const persist = (raw: Expense[]) => {
    const prev = live.current.list;
    const next = touchChanged(prev, raw);
    setList(next); live.current.list = next;
    void signChanges(prev, next);
    if (!saveExpenses(window.localStorage, next, deviceMasked)) setToast("저장 공간이 부족해 이 기기에 저장하지 못했습니다. 오래된 기록을 내보낸 뒤 정리해 주세요.");
  };
  const projects = useMemo(() => [...new Set([...settings.projects, project, ...list.map((e) => e.project)].filter(Boolean))], [list, project, settings.projects]);
  const mine = useMemo(() => sortByDate(list.filter((e) => e.project === project)), [list, project]);
  const attention = useMemo(() => needsAttention(mine), [mine]);
  // 같은 영수증은 다른 사업 이름으로 올라올 수도 있어 전체 기록에서 찾는다.
  const dupIds = useMemo(() => duplicateIds(list), [list]);
  const ME: Actor = { name: settings.submitter, role: settings.role === "approver" ? "approver" : "submitter", shared: !!meta.ws };
  const dupLine = (e: Expense) => findDuplicates(e, list).map((x) => `${md(x.date)} ${x.item || "항목 미입력"} ${won(x.amount ?? 0)}${x.submittedBy ? ` (${x.submittedBy})` : ""}`).join(", ");
  const dupBanner = (e: Expense) => (findDuplicates(e, list).length
    ? <Banner status="warning" title="같은 영수증일 수 있습니다" description={`날짜와 금액이 같은 기록이 이미 있습니다: ${dupLine(e)}. 같은 지출이면 한 건만 남겨 주세요.`} data-testid="dup-warning" />
    : null);
  const set = <K extends keyof Expense>(k: K, v: Expense[K]) => setCur((c) => editField(c, k, v));
  const go = (v: View) => { setView(v); setErr(""); setToast(""); window.scrollTo(0, 0); };
  const resetClose = () => { setClosePhase("idle"); setCloseSteps([]); setCloseOut(null); setCloseErr(""); };
  const resetGroup = () => { setGroupPhase("idle"); setGroupSteps([]); setGroups([]); setGroupNote(""); };

  function startAdd() {
    resetGroup();
    // 사업·행사는 비워 둔다. 에이전트가 지난 기록을 보고 채우거나 묻는다.
    setCur(newExpense({ project: "", submittedBy: SUBMITTER }));
    setEditing(false); setMemo(""); setRaw(null); setBoxes([]); setErr("");
    agentRef.current = null; setPendingIds([]);
    setPhase("idle"); setSteps([]); setQuestions([]); setGuide({ checklist: [], sources: [] });
    setStep("upload"); go("add");
  }
  function startFix(e: Expense) {
    setCur(e); setEditing(true); setErr("");
    setStep("alt"); go("add");
  }
  /** 이미 있는 지출에 거래명세서 같은 자료를 붙이는 화면을 연다. */
  function startAttach(e: Expense) {
    setCur(e); setEditing(true); setRaw(null); setBoxes([]); setErr(""); setAttLabel(ATTACH_LABELS[0]);
    setStep("attach"); go("add");
  }
  /** 고른 사진을 가려서 이 지출에 붙인다. 새 지출을 만들지 않으므로 건수와 금액은 그대로다. */
  async function saveAttach() {
    if (!raw) return;
    try {
      const before = list.find((x) => x.id === cur.id);
      if (!before) throw new Error("먼저 지출을 저장한 뒤에 자료를 붙일 수 있습니다.");
      const id = newAttachmentId();
      const image = await makeMaskedImage(raw, boxes);
      // 원본은 영수증과 같이 이 기기의 보관함에만 둔다.
      await deviceOriginals.put(photoKey(before.id, id), await makeMaskedImage(raw, []));
      const e = attachEvidence(before, { id, label: attLabel, image, original: true }, SUBMITTER);
      persist(list.map((x) => (x.id === e.id ? e : x)));
      resetClose(); setCur(e); setRaw(null); setBoxes([]);
      go("detail"); setToast(`${attLabel} 자료를 이 지출에 붙였습니다.${before.approvedBy ? " 승인이 풀렸으니 다시 승인받아 주세요." : ""}`);
    } catch (e: any) { setErr(e.message || "자료를 붙이지 못했습니다."); }
  }
  function removeAttachment(e: Expense, attachmentId: string) {
    const next = detachEvidence(e, attachmentId, SUBMITTER);
    persist(list.map((x) => (x.id === e.id ? next : x)));
    deviceOriginals.del(photoKey(e.id, attachmentId));
    resetClose(); setCur(next); setToast("자료를 뗐습니다.");
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("사진 파일(JPG, PNG 등)만 올릴 수 있습니다.");
    try { setRaw(await readAsDataUrl(file)); setBoxes([]); setErr(""); } catch (e: any) { setErr(e.message); }
  }
  async function useDemoReceipt() {
    try {
      const res = await fetch("/demo-receipt.png");
      if (!res.ok) throw new Error();
      setRaw(await readAsDataUrl(await res.blob())); setBoxes([]); setErr("");
      if (!memo) setMemo("간식 샀어요");
    } catch { setErr("가상 영수증을 불러오지 못했습니다. 사진을 직접 선택해 주세요."); }
  }

  const history = () =>
    list.filter((e) => e.id !== cur.id).map((e) => ({ project: e.project, item: e.item, budgetCategory: e.budgetCategory, paymentMethod: e.paymentMethod ?? "", amount: e.amount, date: e.date }));

  /** 에이전트를 시작하거나, 질문에 답한 뒤 이어서 돌린다 (AG-UI run). */
  async function callAgent(base: Expense, opts: { image?: string; resume?: boolean }) {
    setPhase("running"); setErr(""); setStep("agent"); window.scrollTo(0, 0);
    try {
      let agent = opts.resume ? agentRef.current : null;
      const prev = (agent?.state ?? {}) as any;
      if (!agent) {
        setSteps([]);
        agent = new HttpAgent({ url: "/api/agent/expense" });
        agentRef.current = agent;
        const image = opts.image ?? (base.evidence.kind === "receipt" ? base.evidence.image : undefined);
        const m = image?.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
        const content: any[] = [{ type: "text", text: maskText(memo) }];
        if (m) content.push({ type: "image", source: { type: "data", value: m[2], mimeType: m[1] } });
        agent.addMessage({ id: crypto.randomUUID(), role: "user", content } as any);
      } else {
        // 사용자의 답을 기다리던 ask_user 호출마다 tool 메시지로 답을 돌려준다.
        const rv = recordValues(base);
        const answers: Record<string, unknown> = {};
        for (const q of questions) {
          const fields = q.field === "payer" || q.field === "reimbursement" ? ["payer", "reimbursement"] : [q.field];
          for (const f of fields) if (rv[f] !== undefined) answers[f] = rv[f];
        }
        for (const id of pendingIds) agent.addMessage({ id: crypto.randomUUID(), role: "tool", toolCallId: id, content: JSON.stringify({ answers, note: Object.keys(answers).length ? "사용자가 답했습니다." : "사용자가 답하지 않고 넘어갔습니다. 다시 묻지 말고 진행하세요." }) } as any);
      }
      agent.setState({
        record: recordValues(base),
        locked: lockedFields(base),
        aiFields: base.aiDrafted.filter((f) => f !== "summary"),
        evidence: { kind: base.evidence.kind, hasImage: !!base.evidence.image, hasReason: !!(base.evidence.reason ?? "").trim() },
        history: history(),
        sources: prev.sources ?? [], searches: prev.searches ?? 0, asks: prev.asks ?? 0,
      });
      const context = [{ description: "단체 이름", value: settings.org }, { description: "지원기관", value: settings.funder }, { description: "지금 화면에서 보고 있는 사업·행사 (지출 날짜와 맞으면 project로 쓸 수 있음)", value: project }].filter((c) => c.value);
      const pending = await runOnce(agent, [ASK_USER_TOOL], (s) => setSteps((p) => [...p, s]), context);
      const st = agent.state as any;
      let next = applyAgentRecord(base, st.record ?? {}, st.aiFields ?? [], pending.length ? "" : st.summary ?? "");
      if (st.docType && next.evidence.image) next = { ...next, evidence: { ...next.evidence, docType: String(st.docType) } };
      if (pending.length) {
        const calls = agent.messages.flatMap((msg: any) => (msg.role === "assistant" ? msg.toolCalls ?? [] : []));
        const qs: AgentQuestion[] = [];
        for (const id of pending) {
          try { qs.push(...(JSON.parse(calls.find((c: any) => c.id === id)?.function?.arguments ?? "{}").questions ?? [])); } catch { /* 형식이 다르면 질문 없이 넘어간다 */ }
        }
        setQuestions(qs); setPendingIds(pending); setPhase("ask");
      } else {
        if (!next.summary) next = { ...next, summary: fallbackSummary(next) };
        setQuestions([]); setPendingIds([]);
        setGuide({ checklist: st.checklist ?? [], sources: st.sources ?? [] });
        setPhase("done");
      }
      setCur(next);
    } catch (e: any) {
      setErr(e.message || `에이전트가 작업을 마치지 못했습니다. ${MANUAL}`);
      setPhase("error");
    }
  }
  async function startAgent() {
    try {
      let base = cur;
      let image: string | undefined;
      if (raw) {
        image = await makeMaskedImage(raw, boxes);
        // 원본(가리지 않은 사진)은 이 기기의 보관함에만 둔다. AI에는 가린 사진만 간다.
        await deviceOriginals.put(cur.id, await makeMaskedImage(raw, []));
        base = withStatus({ ...cur, evidence: { kind: "receipt", image, original: true } });
        setCur(base);
      }
      await callAgent(base, { image });
    } catch (e: any) {
      setErr(e.message); setPhase("error"); setStep("agent");
    }
  }

  function confirm() {
    let e = cur;
    if (!e.summary) e = { ...e, summary: fallbackSummary(e) };
    if (guide.checklist.length) e = { ...e, guidance: { query: "", sources: guide.sources, checklist: guide.checklist, searchedAt: new Date().toISOString() } };
    e = reconfirmExpense(e, SUBMITTER, list.find((x) => x.id === e.id));
    persist(list.some((x) => x.id === e.id) ? list.map((x) => (x.id === e.id ? e : x)) : [...list, e]);
    if (e.project) setProject(e.project);
    resetClose();
    setCur(e); setStep("saved"); window.scrollTo(0, 0);
  }
  function saveFix() {
    const e = withStatus(cur);
    persist(list.map((x) => (x.id === e.id ? e : x)));
    resetClose();
    go("review"); setToast(evidenceMissing(e) ? "저장했습니다. 증빙은 아직 보완이 필요합니다." : "증빙을 보완했습니다.");
  }
  function approve(e: Expense) {
    const block = approvalBlock(e, ME);
    if (block) return setToast(`${block}.`);
    persist(list.map((x) => (x.id === e.id ? approveExpense(x, APPROVER) : x)));
    resetClose();
    setToast(`${e.item} ${won(e.amount ?? 0)}을 승인했습니다.`);
  }
  async function runClose() {
    setClosePhase("running"); setCloseSteps([]); setCloseOut(null); setCloseErr("");
    try {
      const records = mine.map((e) => ({ ...e, guidance: undefined, evidence: { ...e.evidence, image: e.evidence.image ? "attached" : undefined } }));
      const agent = new HttpAgent({ url: "/api/agent/close", initialState: { project, records } });
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: `"${project}" 사업의 정산 마감 전 점검을 해 주세요.` } as any);
      await runOnce(agent, [], (s) => setCloseSteps((p) => [...p, s]));
      const st = agent.state as any;
      setCloseOut({ briefing: st.briefing ?? "", requests: st.requests ?? [] }); setClosePhase("done");
    } catch (e: any) {
      setCloseErr((e.message || "마감 점검을 마치지 못했습니다.").replace(MANUAL, "아래 목록에서 직접 확인할 수 있습니다.")); setClosePhase("error");
    }
  }
  async function copy(id: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(id); } catch { setCopied(""); }
  }

  // 가림 상자 그리기
  const pos = (ev: React.PointerEvent<HTMLDivElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)) };
  };
  const boxOf = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  function leaveWorkspace() {
    window.localStorage.removeItem(SYNC_KEY);
    setMeta(EMPTY_META); live.current.meta = EMPTY_META; setSyncNote(""); setConfirmLeave(false);
  }
  async function createWorkspace() {
    const ws = newWorkspace();
    keepMeta({ ...EMPTY_META, ws, sharedAt: new Date().toISOString() });
    await doSync(ws);
  }
  async function joinWorkspace() {
    if (!joinWs) return;
    const name = draft.submitter.trim();
    if (!name) return setErr("내 이름을 입력해 주세요.");
    const st: Settings = { ...live.current.settings, submitter: name, role: draft.approver === "approver" ? "approver" : "submitter", onboarded: true };
    setSettings(st); live.current.settings = st; saveSettings(window.localStorage, st);
    keepMeta({ ...EMPTY_META, ws: joinWs });
    window.history.replaceState(null, "", window.location.pathname);
    setErr(""); setJoinWs(null); go("list");
    await doSync(joinWs);
  }
  const inviteLink = meta.ws && typeof window !== "undefined" ? `${window.location.origin}/app#${inviteCode(meta.ws)}` : "";
  function loadDemo() {
    leaveWorkspace();
    keep(DEMO_SETTINGS);
    persist(resetToSeed(window.localStorage));
    setProject(DEMO_PROJECT); resetClose(); go("list");
  }
  function startOwn() {
    const next: Settings = { ...EMPTY_SETTINGS, org: draft.org.trim(), submitter: draft.submitter.trim(), approver: draft.approver.trim(), projects: draft.project.trim() ? [draft.project.trim()] : [], funder: draft.funder.trim(), onboarded: true };
    const miss = missingForStart(next);
    if (miss.length) return setErr(`${miss.join(", ")}을(를) 입력해 주세요.`);
    leaveWorkspace(); keep(next); persist([]); setProject(next.projects[0]); go("list");
  }
  function openDetail(e: Expense) { setCur(e); setConfirmDelete(false); go("detail"); }
  function editExisting(e: Expense) {
    // 고치면 다시 승인받아야 한다.
    setCur({ ...e, approvedBy: undefined, approvedAt: undefined, confirmed: false });
    setEditing(false); setPhase("idle"); setGuide({ checklist: e.guidance?.checklist ?? [], sources: e.guidance?.sources ?? [] });
    setStep("edit"); go("add");
  }
  function removeExpense(e: Expense) {
    // 다른 기기에서 되살아나지 않도록 삭제 기록을 남긴다.
    if (live.current.meta.ws) keepMeta({ ...live.current.meta, tombstones: { ...live.current.meta.tombstones, [e.id]: new Date().toISOString() } });
    persist(list.filter((x) => x.id !== e.id));
    for (const s of slotsOf(e)) deviceOriginals.del(s.key);
    deviceOriginals.del(e.id);
    resetClose(); go("list"); setToast(`${e.item || "기록"} 건을 삭제했습니다.`);
  }
  async function importBackup(file: File | undefined) {
    if (!file) return;
    const back = parseBackup(await file.text());
    if (!back) return setErr("열린영수증 백업 파일이 아닙니다. 설정 화면에서 내보낸 .json 파일을 선택해 주세요.");
    keep(back.settings); persist(back.expenses.map(withStatus));
    if (back.settings.projects[0]) setProject(back.settings.projects[0]);
    resetClose(); go("list"); setToast(`백업에서 기록 ${back.expenses.length}건을 가져왔습니다.`);
  }
  async function makeShareLink() {
    const r = buildReport(list, project);
    const proof = { fingerprint: await recordsFingerprint(mine), ledger: await summarize(live.current.led.ledger) };
    const code = await encodeShare({ ...buildShare(r, settings.org, { includeRows: share.rows === "rows", showNames: share.names === "show" }), proof });
    const link = `${window.location.origin}/r#${code}`;
    setShare((sh) => ({ ...sh, link, note: link.length > LONG_LINK ? "링크가 길어 일부 메신저에서 잘릴 수 있습니다. '요약만'으로 줄이거나 보고서 파일을 보내 주세요." : "" }));
  }
  async function copyShare() {
    try { await navigator.clipboard.writeText(share.link); setShare((sh) => ({ ...sh, note: "링크를 복사했습니다." })); }
    catch { setShare((sh) => ({ ...sh, note: "복사하지 못했습니다. 아래 링크를 길게 눌러 직접 복사해 주세요." })); }
  }
  async function nativeShare() {
    try { await navigator.share({ title: `${project} 결산보고서 초안`, text: `${settings.org} ${project} 결산보고서 초안입니다.`, url: share.link }); }
    catch { /* 사용자가 닫았거나 지원하지 않는 기기 */ }
  }

  /* ---------- 여러 장 한꺼번에 올리기 ---------- */
  const BULK_MAX = 30;
  async function addBulkFiles(files: FileList | null) {
    if (!files) return;
    const room = BULK_MAX - bulk.length;
    const picked = [...files].filter((f) => f.type.startsWith("image/")).slice(0, room);
    const added: BulkItem[] = [];
    for (const f of picked) {
      try { added.push({ id: crypto.randomUUID(), name: f.name, raw: await readAsDataUrl(f), boxes: [], state: "ready", note: "" }); } catch { /* 읽지 못한 파일은 건너뛴다 */ }
    }
    setBulk((b) => [...b, ...added]);
    setErr(files.length > picked.length ? `사진 파일만, 한 번에 ${BULK_MAX}장까지 올릴 수 있습니다. ${files.length - picked.length}개는 빠졌습니다.` : "");
  }
  const patchBulk = (id: string, patch: Partial<BulkItem>) => setBulk((b) => b.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  /** 영수증 한 장을 에이전트에 맡겨 초안으로 저장한다. 묻지 않고 끝까지 진행시킨다. */
  async function runBulkOne(item: BulkItem) {
    patchBulk(item.id, { state: "running", note: "읽는 중…" });
    try {
      const image = await makeMaskedImage(item.raw, item.boxes);
      const id = `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      await deviceOriginals.put(id, await makeMaskedImage(item.raw, []));
      const base = newExpense({ id, project, submittedBy: SUBMITTER, evidence: { kind: "receipt", image, original: true } });
      const agent = new HttpAgent({ url: "/api/agent/expense" });
      const m = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/)!;
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: [{ type: "text", text: maskText(bulkMemo) }, { type: "image", source: { type: "data", value: m[2], mimeType: m[1] } }] } as any);
      agent.setState({
        record: recordValues(base), locked: lockedFields(base), aiFields: [],
        evidence: { kind: "receipt", hasImage: true, hasReason: false },
        history: live.current.list.map((e) => ({ project: e.project, item: e.item, budgetCategory: e.budgetCategory, paymentMethod: e.paymentMethod ?? "", amount: e.amount, date: e.date })),
        sources: [], searches: 0, asks: 0,
      });
      const context = [{ description: "단체 이름", value: settings.org }, { description: "지원기관", value: settings.funder }].filter((c) => c.value);
      await runOnce(agent, [], (st) => patchBulk(item.id, { note: st.label }), context);
      const st = agent.state as any;
      let next = applyAgentRecord(base, st.record ?? {}, st.aiFields ?? [], st.summary ?? "");
      if (!next.summary) next = { ...next, summary: fallbackSummary(next) };
      if (st.docType) next = { ...next, evidence: { ...next.evidence, docType: String(st.docType) } };
      if (st.checklist?.length) next = { ...next, guidance: { query: "", sources: st.sources ?? [], checklist: st.checklist, searchedAt: new Date().toISOString() } };
      persist([...live.current.list, next]); // 초안으로 저장. 확정은 사람이 한다.
      const miss = missingFields(next);
      patchBulk(item.id, { state: "done", note: `${next.item || "항목 미입력"} · ${won(next.amount ?? 0)}${miss.length ? ` · 확인 필요: ${miss.join(", ")}` : ""}` });
    } catch (e: any) {
      patchBulk(item.id, { state: "error", note: (e?.message || "정리하지 못했습니다.").replace(MANUAL, "다시 시도하거나 한 장씩 올려 주세요.") });
    }
  }
  async function runBulk() {
    setBulkBusy(true); setErr(""); setBulkMask(null);
    const queue = bulk.filter((x) => x.state === "ready" || x.state === "error");
    // 두 장씩 나란히 처리한다.
    const worker = async () => { for (let it = queue.shift(); it; it = queue.shift()) await runBulkOne(it); };
    await Promise.all([worker(), worker()]);
    resetClose(); setBulkBusy(false);
    // 방금 올린 서류 가운데 같은 거래의 것이 있는지 바로 살핀다.
    void runGroup(true);
  }

  /* ---------- 같은 거래의 서류 묶기 ---------- */
  /** 이 사업의 서류 가운데 합칠 수 있는 것 (승인 전이고 사진이 있는 기록). */
  const groupPool = () => live.current.list.filter((e) => e.project === project && groupable(e));
  /** 묶음 에이전트를 돌린다. quiet면 견줄 서류가 없을 때나 실패했을 때 조용히 넘어간다. */
  async function runGroup(quiet = false) {
    const docs = toGroupDocs(groupPool());
    if (docs.length < 2) { resetGroup(); if (!quiet) { setGroupNote("견줄 서류가 두 장보다 적습니다."); setGroupPhase("done"); } return; }
    setGroupPhase("running"); setGroupSteps([]); setGroups([]); setGroupNote("");
    try {
      const agent = new HttpAgent({ url: "/api/agent/group" });
      agent.addMessage({ id: crypto.randomUUID(), role: "user", content: "따로 올라온 서류 가운데 같은 거래의 서류를 찾아 묶음을 제안해 주세요." } as any);
      agent.setState({ documents: docs, groups: [], note: "" });
      await runOnce(agent, [], (s) => setGroupSteps((p) => [...p, s]));
      const st = agent.state as any;
      // 서버가 준 제안도 지금 기록과 견줘 한 번 더 걸러 낸다.
      const found = stillValid(st.groups, toGroupDocs(groupPool()));
      setGroups(found); setGroupNote(found.length ? "" : String(st.note || "한 거래로 묶을 서류를 찾지 못했습니다.")); setGroupPhase("done");
    } catch (e: any) {
      if (quiet) return resetGroup();
      setGroupNote((e.message || "서류를 살피지 못했습니다.").replace(MANUAL, "지출 상세의 \"자료 붙이기\"로 직접 묶을 수 있습니다.")); setGroupPhase("error");
    }
  }
  /** 기록 여러 건을 한 건으로 합쳐 저장한다. 사라지는 기록의 원본 사진은 남는 기록 아래로 옮긴다. */
  async function applyMerge(main: Expense, others: Expense[]) {
    const { merged, removed, moves } = mergeGroup(main, others, SUBMITTER);
    for (const m of moves) {
      const original = await deviceOriginals.get(m.from);
      if (original) await deviceOriginals.put(m.to, original);
      await deviceOriginals.del(m.from);
    }
    const gone = new Set(removed);
    // 다른 기기에서 되살아나지 않도록 삭제 기록을 남긴다.
    if (live.current.meta.ws) {
      const at = new Date().toISOString();
      keepMeta({ ...live.current.meta, tombstones: { ...live.current.meta.tombstones, ...Object.fromEntries(removed.map((id) => [id, at])) } });
    }
    const cur2 = live.current.list;
    persist(cur2.some((x) => x.id === merged.id) ? cur2.filter((x) => !gone.has(x.id)).map((x) => (x.id === merged.id ? merged : x)) : [...cur2.filter((x) => !gone.has(x.id)), merged]);
    resetClose();
    return merged;
  }
  /** 사람이 제안을 받아들였을 때. 그 사이 기록이 바뀌었으면 합치지 않는다. */
  async function acceptGroup(g: GroupProposal) {
    const pool = groupPool();
    const main = pool.find((e) => e.id === g.mainId);
    const others = g.ids.filter((id) => id !== g.mainId).map((id) => pool.find((e) => e.id === id));
    setGroups((gs) => gs.filter((x) => x !== g));
    if (!main || others.some((o) => !o)) return setToast("그 사이 기록이 바뀌어 합치지 못했습니다. 다시 찾아 주세요.");
    const merged = await applyMerge(main, others as Expense[]);
    setToast(`${merged.item || "지출"} ${won(merged.amount ?? 0)}: 서류 ${g.ids.length}장을 한 건으로 합쳤습니다.`);
  }
  /** 지금 올리던 서류를 새 지출로 저장하지 않고, 이미 있는 기록의 자료로 붙인다. */
  async function attachToExisting(existing: Expense) {
    try {
      const merged = await applyMerge(existing, [cur]);
      setCur(merged); go("detail"); setToast("새 지출을 만들지 않고, 이 기록의 자료로 붙였습니다.");
    } catch (e: any) { setErr(e.message || "자료를 붙이지 못했습니다."); }
  }
  /** 필수 정보가 다 채워진 초안을 한꺼번에 확정한다. */
  function confirmDrafts() {
    const ready = mine.filter((e) => e.status === "draft" && !e.confirmed && missingFields(e).length === 0);
    if (!ready.length) return;
    // 같은 영수증일 수 있는 초안은 남겨 두고 사람이 하나씩 확인하게 한다.
    // 초안끼리 겹치면 먼저 것만 확정한다.
    const kept: Expense[] = list.filter((e) => e.confirmed);
    const ids = new Set<string>();
    for (const e of ready) {
      if (findDuplicates(e, kept).length) continue;
      ids.add(e.id); kept.push(e);
    }
    const held = ready.length - ids.size;
    if (ids.size) persist(list.map((e) => (ids.has(e.id) ? confirmExpense(e, SUBMITTER) : e)));
    resetClose();
    setToast(`${ids.size}건을 확정했습니다.${ids.size ? " 승인자 확인을 기다립니다." : ""}${held ? ` ${held}건은 같은 영수증일 수 있어 초안으로 남겼습니다. 열어서 확인해 주세요.` : ""}`);
  }
  const draftsReady = mine.filter((e) => e.status === "draft" && !e.confirmed && missingFields(e).length === 0).length;

  /** 등록자·승인자가 보는 증빙 사진: 가린 사진과, 있으면 원본. 한 지출의 영수증과 함께 묶은 자료가 차례로 나온다. */
  const receiptItems = (items: Expense[]) =>
    items.flatMap((e) => reportPhotos([e], e.project)).map((p) => ({
      id: p.key,
      caption: `${p.caption} · ${p.label}`,
      masked: p.image,
      loadOriginal: p.original ? () => deviceOriginals.get(p.key) : undefined,
    }));

  /** 묶음 제안 카드. 여러 장 올리기 화면과 검토 화면이 함께 쓴다. */
  const docLine = (id: string) => {
    const e = list.find((x) => x.id === id);
    return e ? `${md(e.date)} · ${e.evidence.docType || "서류"} · ${e.item || "항목 미입력"} · ${won(e.amount ?? 0)}` : "지워진 기록";
  };
  const groupCard = (
    <Card data-testid="group-card">
      <VStack gap={3}>
        <Heading level={2}>같은 거래 찾기</Heading>
        {groupPhase === "idle" ? <Note>카드영수증, 거래명세서, 주문 화면 캡처처럼 한 번 쓴 돈의 서류가 따로 올라와 있으면, 에이전트가 찾아 한 건으로 합치자고 제안합니다. 합치는 것은 직접 누를 때만 됩니다.</Note> : null}
        {groupSteps.length > 0 || groupPhase === "running" ? <Log items={groupSteps} running={groupPhase === "running"} /> : null}
        {groupNote ? (groupPhase === "error" ? <Banner status="error" title={groupNote} /> : <Note>{groupNote}</Note>) : null}
        {groups.map((g) => (
          <Card key={g.ids.join("+")} variant="muted" padding={3} data-testid="group">
            <VStack gap={2}>
              <Text weight="semibold">한 거래로 보이는 서류 {g.ids.length}장</Text>
              <List hasDividers edge="flush" density="compact">
                {g.ids.map((id) => <ListItem key={id} label={<Text hasTabularNumbers>{docLine(id)}</Text>} endContent={id === g.mainId ? <Token label="남길 기록" color="green" size="sm" /> : undefined} />)}
              </List>
              <Text>{g.reason}</Text>
              {g.mismatch ? <Banner status="warning" title="확인할 점" description={g.mismatch} /> : null}
              <Note>합치면 "남길 기록" 한 건만 남고, 나머지 서류는 그 기록의 자료로 붙습니다. 금액은 더하지 않습니다.</Note>
              <HStack gap={2}>
                <Main label="한 건으로 합치기" onClick={() => acceptGroup(g)} />
                <Sub label="따로 두기" onClick={() => setGroups((gs) => gs.filter((x) => x !== g))} />
              </HStack>
            </VStack>
          </Card>
        ))}
        {groupPhase !== "running" ? <Sub label={groupPhase === "idle" ? "같은 거래 찾기" : "다시 찾기"} onClick={() => runGroup()} /> : null}
      </VStack>
    </Card>
  );

  if (!ready) return <Frame title="열린영수증"><Note>불러오는 중…</Note></Frame>;

  /* ---------- 첫 방문 소개 ---------- */
  if (view === "intro") {
    const f = (k: keyof typeof draft, label: string, placeholder: string, optional = false) => (
      <TextInput id={`s-${k}`} label={optional ? `${label} (선택)` : label} value={draft[k]} placeholder={placeholder} onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} />
    );
    if (joinWs) {
      return (
        <Frame title="단체 공간 참여">
          <VStack gap={2}>
            <Heading level={2}>초대받은 단체 공간에 참여합니다</Heading>
            <Text>참여하면 이 단체의 지출 기록을 이 기기에서도 보고, 올리고, 승인할 수 있습니다. 기록은 암호화되어 오가며 초대 링크를 가진 사람만 볼 수 있습니다.</Text>
          </VStack>
          {err ? <Banner status="error" title={err} /> : null}
          {list.length > 0 ? <Banner status="warning" title={`이 기기에 있던 기록 ${list.length}건도 단체 공간에 합쳐집니다.`} /> : null}
          <TextInput id="j-name" label="내 이름" value={draft.submitter} placeholder="예: 박대표" onChange={(v) => setDraft((d) => ({ ...d, submitter: v }))} />
          <SegmentedControl label="내 역할" layout="fill" value={draft.approver === "approver" ? "approver" : "submitter"} onChange={(v) => setDraft((d) => ({ ...d, approver: v }))}>
            <SegmentedControlItem value="submitter" label="기록을 올리는 사람" />
            <SegmentedControlItem value="approver" label="승인하는 사람" />
          </SegmentedControl>
          <Note>승인하는 사람으로 참여하면 승인할 때 내 이름이 승인자로 기록됩니다.</Note>
          <VStack className="grow" />
          <Main label="참여하기" onClick={joinWorkspace} />
          <Sub label="참여하지 않기" onClick={() => { window.history.replaceState(null, "", window.location.pathname); setJoinWs(null); setErr(""); if (settings.onboarded || list.length) go("list"); }} />
        </Frame>
      );
    }
    return (
      <Frame title="열린영수증">
        <VStack gap={2}>
          <Heading level={2}>지출 한 건마다 증빙 묶음을 완성합니다</Heading>
          <Text>회계 전담자가 없는 작은 단체·동아리·모임을 위한 AI 에이전트입니다. 영수증을 올리면 에이전트가 기록을 채우고, 모르는 것만 되묻고, 관련 공개 지침을 찾아 정산 가능한 기록으로 만들어 둡니다.</Text>
        </VStack>
        <Card>
          <List hasDividers edge="flush">
            <ListItem label={<Text weight="semibold">1. 영수증을 올립니다</Text>} description={<Text type="supporting" color="secondary">이름·카드번호는 직접 가립니다. AI에는 가린 사진만 보내고, 원본은 등록자와 승인자만 봅니다.</Text>} />
            <ListItem label={<Text weight="semibold">2. 에이전트가 정리합니다</Text>} description={<Text type="supporting" color="secondary">일자·금액·결제 방식을 읽고, 지난 기록을 참고하고, 목적이나 환급 여부처럼 알 수 없는 것만 여쭙니다.</Text>} />
            <ListItem label={<Text weight="semibold">3. 사람이 확정하고 승인합니다</Text>} description={<Text type="supporting" color="secondary">에이전트는 판정하지 않습니다. 확인할 항목만 알려 주고, 확정과 승인은 담당자가 합니다.</Text>} />
            <ListItem label={<Text weight="semibold">4. 결산보고서를 만들고 공유합니다</Text>} description={<Text type="supporting" color="secondary">등록자와 승인자는 각자 기기에서 함께 쓰고, 후원자는 링크로 결산보고서와 가린 영수증을 받아 봅니다.</Text>} />
          </List>
        </Card>
        <Note>기록은 이 기기에 저장됩니다. 여러 사람이 각자 기기에서 함께 쓰려면 시작한 뒤 설정에서 단체 공간을 만들어 초대 링크를 보내세요.</Note>
        <Card>
          <VStack gap={3}>
            <Heading level={3}>우리 단체로 시작하기</Heading>
            {err ? <Banner status="error" title={err} /> : null}
            {f("org", "단체 이름", "예: 다온 나눔모임")}
            {f("submitter", "내 이름 (기록을 올리는 사람)", "예: 김다온")}
            {f("approver", "승인하는 사람", "예: 박대표", true)}
            {f("project", "첫 사업·행사 이름", "예: 자원봉사자 워크숍")}
            {f("funder", "지원기관", "예: 서울시. 에이전트가 지침을 찾을 때 참고합니다.", true)}
            <Main label="시작하기" onClick={startOwn} />
          </VStack>
        </Card>
        <Sub label="데모 데이터 불러오기" onClick={loadDemo} />
        <Note>데모는 가상 단체와 가상 지출 2건으로 바로 둘러볼 수 있습니다.</Note>
        <Button label="개발자 안내 (에이전트 API)" variant="ghost" href="/developers" />
      </Frame>
    );
  }

  /* ---------- 여러 장 한꺼번에 올리기 ---------- */
  if (view === "bulk") {
    const todo = bulk.filter((x) => x.state === "ready" || x.state === "error").length;
    const done = bulk.filter((x) => x.state === "done").length;
    const target = bulk.find((x) => x.id === bulkMask);
    const stateLabel: Record<BulkItem["state"], [string, "gray" | "blue" | "green" | "red"]> = { ready: ["대기", "gray"], running: ["정리 중", "blue"], done: ["완료", "green"], error: ["실패", "red"] };
    return (
      <Frame title="영수증 여러 장 올리기" side={project}>
        {err ? <Banner status="error" title={err} /> : null}
        <Note>행사가 끝난 뒤 모아 둔 영수증을 한꺼번에 올리면, 에이전트가 한 장씩 읽어 "{project}" 사업의 기록 초안으로 정리합니다. 묻지 않고 끝까지 진행하며, 빠진 정보는 나중에 한 건씩 채웁니다.</Note>
        <input ref={bulkRef} id="bulk-files" type="file" accept="image/*" multiple hidden onChange={(e) => { addBulkFiles(e.target.files); e.target.value = ""; }} />
        <Sub label={bulk.length ? "사진 더 추가" : "사진 선택 (여러 장)"} isDisabled={bulkBusy || bulk.length >= BULK_MAX} onClick={() => bulkRef.current?.click()} />
        <TextInput id="bulk-memo" label="공통 메모 (선택)" value={bulkMemo} placeholder="예: 11월 워크숍 준비물과 다과" onChange={setBulkMemo} />
        {target ? (
          <Card>
            <VStack gap={2}>
              <Heading level={3}>{target.name} 가리기</Heading>
              <div className="maskwrap" aria-label="영수증 미리보기. 끌어서 가릴 영역을 그립니다."
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = pos(e); }}
                onPointerMove={(e) => { if (drag.current) setDragBox(boxOf(drag.current, pos(e))); }}
                onPointerUp={(e) => { if (drag.current) { const b = boxOf(drag.current, pos(e)); if (b.w > 0.02 && b.h > 0.01) patchBulk(target.id, { boxes: [...target.boxes, b] }); } drag.current = null; setDragBox(null); }}>
                <img src={target.raw} alt="영수증" />
                {[...target.boxes, ...(dragBox ? [dragBox] : [])].map((b, i) => <i key={i} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />)}
              </div>
              <HStack gap={2}>
                <Sub label="되돌리기" isDisabled={!target.boxes.length} onClick={() => patchBulk(target.id, { boxes: target.boxes.slice(0, -1) })} />
                <Main label="가림 완료" onClick={() => setBulkMask(null)} />
              </HStack>
            </VStack>
          </Card>
        ) : null}
        {bulk.length ? (
          <List hasDividers edge="flush" data-testid="bulk-list">
            {bulk.map((x) => (
              <ListItem key={x.id} align="start"
                label={<Text>{x.name}</Text>}
                description={<Text type="supporting" color="secondary">{x.note || (x.boxes.length ? `가린 상자 ${x.boxes.length}개` : "가림 없음")}</Text>}
                endContent={
                  <HStack gap={1.5} align="center">
                    <Token label={stateLabel[x.state][0]} color={stateLabel[x.state][1]} size="sm" />
                    {x.state === "ready" && !bulkBusy ? <>
                      <Button label="가리기" size="sm" variant="ghost" onClick={() => setBulkMask(x.id)} />
                      <Button label="빼기" size="sm" variant="ghost" onClick={() => setBulk((b) => b.filter((y) => y.id !== x.id))} />
                    </> : null}
                  </HStack>
                } />
            ))}
          </List>
        ) : null}
        <Note>AI에는 여기서 가린 사진만 보냅니다. 이름이나 카드번호 전체가 보이는 영수증은 "가리기"로 가린 뒤 맡겨 주세요. 원본은 등록자와 승인자만 볼 수 있습니다.</Note>
        {done > 0 && !bulkBusy ? <Banner status="success" title={`${done}장을 초안으로 정리했습니다.`} description="목록에서 한 건씩 열어 확인하거나, 필수 정보가 다 채워진 초안을 한꺼번에 확정할 수 있습니다." /> : null}
        {toast ? <Banner status="success" title={toast} /> : null}
        {groupPhase !== "idle" && !bulkBusy ? groupCard : null}
        <VStack className="grow" />
        <Main label={bulkBusy ? `정리하는 중… (${done}/${bulk.length})` : todo ? `${todo}장 에이전트에게 맡기기` : "에이전트에게 맡기기"} isDisabled={bulkBusy || todo === 0} onClick={runBulk} />
        <Sub label="지출 목록으로" isDisabled={bulkBusy} onClick={() => { setBulk((b) => b.filter((x) => x.state !== "done")); go("list"); }} />
      </Frame>
    );
  }

  /* ---------- 설정 ---------- */
  if (view === "settings") {
    const upd = (k: "org" | "submitter" | "approver" | "funder") => (v: string) => keep({ ...settings, [k]: v });
    return (
      <Frame title="설정" side={settings.org}>
        {err ? <Banner status="error" title={err} /> : null}
        <TextInput id="s-org" label="단체 이름" value={settings.org} onChange={upd("org")} />
        <TextInput id="s-submitter" label="내 이름 (기록을 올리는 사람)" value={settings.submitter} onChange={upd("submitter")} />
        <TextInput id="s-approver" label="승인하는 사람" value={settings.approver} onChange={upd("approver")} />
        <TextInput id="s-funder" label="지원기관 (선택)" value={settings.funder} description="에이전트가 정산 지침을 찾을 때 참고합니다." onChange={upd("funder")} />
        <Card>
          <VStack gap={2}>
            <Heading level={3}>사업·행사</Heading>
            <HStack gap={1.5} wrap="wrap">{projects.map((p) => <Token key={p} label={p} />)}</HStack>
            <TextInput id="s-new-project" label="새 사업·행사 이름" value={newProject} placeholder="예: 겨울 캠프" onChange={setNewProject} />
            <Sub label="사업 추가" isDisabled={!newProject.trim()} onClick={() => { const n = newProject.trim(); keep(addProject(settings, n)); setProject(n); setNewProject(""); resetClose(); }} />
          </VStack>
        </Card>
        <SegmentedControl label="내 역할" layout="fill" value={settings.role} onChange={(v) => keep({ ...settings, role: v === "approver" ? "approver" : "submitter" })}>
          <SegmentedControlItem value="submitter" label="기록을 올리는 사람" />
          <SegmentedControlItem value="approver" label="승인하는 사람" />
        </SegmentedControl>
        <Card data-testid="workspace">
          <VStack gap={3}>
            <Heading level={3}>단체 공간 (기기 간 공유)</Heading>
            {meta.ws ? <>
              <Note>초대 링크를 받은 사람은 자기 기기에서 같은 기록을 보고, 올리고, 승인할 수 있습니다. 기록은 기기에서 암호화되어 오가므로 서버는 내용을 읽을 수 없습니다. 링크를 가진 사람은 누구나 참여할 수 있으니 단체 사람에게만 보내세요.</Note>
              <TextInput id="invite-link" label="초대 링크" isReadOnly value={inviteLink} onChange={() => {}} />
              <HStack gap={2}>
                <Sub label="초대 링크 복사" onClick={async () => { try { await navigator.clipboard.writeText(inviteLink); setSyncNote("초대 링크를 복사했습니다."); } catch { setSyncNote("복사하지 못했습니다. 링크를 직접 선택해 복사해 주세요."); } }} />
                <Sub label={syncing ? "동기화하는 중…" : "지금 동기화"} isDisabled={syncing} onClick={() => doSync()} />
              </HStack>
              <Note>{syncNote || (meta.syncedAt ? `마지막 동기화 ${new Date(meta.syncedAt).toLocaleString("ko-KR")}` : "아직 동기화하지 않았습니다.")}</Note>
              <Heading level={3}>후원자용 보기</Heading>
              <Note>후원자는 결산보고서와 가린 영수증만 볼 수 있습니다. 원본 사진은 볼 수 없고, 기록을 고칠 수도 없습니다. 기록이 바뀌면 보고서도 따라 바뀝니다.</Note>
              <SegmentedControl label="후원자용 보기" layout="fill" value={settings.sponsorView ? "on" : "off"} onChange={(v) => keep({ ...settings, sponsorView: v === "on" })}>
                <SegmentedControlItem value="off" label="닫힘" />
                <SegmentedControlItem value="on" label="열림" />
              </SegmentedControl>
              {settings.sponsorView ? <>
                <SegmentedControl label="후원자에게 이름 표시" layout="fill" value={settings.sponsorNames ? "show" : "hide"} onChange={(v) => keep({ ...settings, sponsorNames: v === "show" })}>
                  <SegmentedControlItem value="hide" label="이름 가림" />
                  <SegmentedControlItem value="show" label="이름 표시" />
                </SegmentedControl>
                <TextInput id="viewer-link" label="후원자용 보기 링크" isReadOnly value={viewerLink} onChange={() => {}} />
                <Sub label="후원자용 링크 복사" onClick={async () => { try { await navigator.clipboard.writeText(viewerLink); setSyncNote("후원자용 링크를 복사했습니다."); } catch { setSyncNote("복사하지 못했습니다. 링크를 직접 선택해 복사해 주세요."); } }} />
              </> : null}
              {confirmLeave
                ? <HStack gap={2}><Button label="연결 끊기 확인" variant="destructive" width="100%" onClick={leaveWorkspace} /><Sub label="취소" onClick={() => setConfirmLeave(false)} /></HStack>
                : <Button label="이 기기의 연결 끊기" variant="ghost" onClick={() => setConfirmLeave(true)} />}
              {confirmLeave ? <Note>연결을 끊어도 이 기기의 기록은 남습니다. 다시 참여하려면 초대 링크가 필요하니 먼저 복사해 두세요.</Note> : null}
            </> : <>
              <Note>총무와 승인자가 각자 기기에서 같은 기록을 쓰려면 단체 공간을 만드세요. 만든 뒤 나오는 초대 링크를 보내면 됩니다.</Note>
              <Sub label={syncing ? "만드는 중…" : "단체 공간 만들기"} isDisabled={syncing} onClick={createWorkspace} />
              {syncNote ? <Note>{syncNote}</Note> : null}
            </>}
          </VStack>
        </Card>
        <Card>
          <VStack gap={2}>
            <Heading level={3}>백업</Heading>
            <Note>기록은 이 브라우저에만 저장됩니다. 백업 파일에는 가린 영수증 이미지도 들어갑니다.</Note>
            <input ref={importRef} id="import" type="file" accept="application/json,.json" hidden onChange={(e) => importBackup(e.target.files?.[0])} />
            <HStack gap={2}>
              <Sub label="백업 내보내기" onClick={() => download(`열린영수증_백업_${new Date().toISOString().slice(0, 10)}.json`, makeBackup(settings, list), "application/json")} />
              <Sub label="백업 가져오기" onClick={() => importRef.current?.click()} />
            </HStack>
          </VStack>
        </Card>
        <Card data-testid="ledger">
          <VStack gap={2}>
            <Heading level={2}>서명 원장</Heading>
            <Note>기록을 올리거나 고치거나 승인할 때마다 이 기기의 열쇠로 서명해 원장에 한 줄씩 남깁니다. 단체 공간의 모든 기기가 서로의 원장 사본을 갖고, 동기화할 때마다 검증합니다.</Note>
            <List hasDividers edge="flush" density="compact">
              <ListItem label={<Text color="secondary">이 기기의 열쇠</Text>} endContent={<Text hasTabularNumbers>{led.me ? led.me.key.slice(0, 8) : "첫 기록 때 만듭니다"}</Text>} />
              <ListItem label={<Text color="secondary">원장 지문</Text>} endContent={<Text id="ledger-head" hasTabularNumbers>{ledSum && ledSum.entries ? shortPrint(ledSum.head) : "아직 없음"}</Text>} />
              <ListItem label={<Text color="secondary">서명</Text>} endContent={<Text id="ledger-size">{ledSum ? `${ledSum.entries}줄 · 기기 ${ledSum.devices}대` : ""}</Text>} />
            </List>
            {members(led.ledger).length ? (
              <List hasDividers edge="flush" density="compact">
                {members(led.ledger).map((m) => (
                  <ListItem key={m.key} data-testid="ledger-member"
                    label={`${m.name || "이름 없음"}${led.me?.key === m.key ? " (이 기기)" : ""}`}
                    description={`${m.role === "approver" ? "승인하는 사람" : "기록을 올리는 사람"} · 열쇠 ${m.key.slice(0, 8)} · ${m.firstAt.slice(0, 10)}부터`}
                    endContent={<Text hasTabularNumbers>{`${m.entries}줄`}</Text>} />
                ))}
              </List>
            ) : null}
            {ledProblems.length
              ? <Banner status="error" title={`받은 원장에서 문제 ${ledProblems.length}건을 발견했습니다`} description={`${ledProblems.map((x) => x.text).join(" / ")}. 문제가 있는 사본은 받지 않고 이 기기의 사본을 지켰습니다.`} data-testid="ledger-problem" />
              : meta.ws && meta.syncedAt ? <Note>마지막 동기화에서 받은 원장을 모두 검증했습니다. 문제가 없습니다.</Note> : null}
            {(() => {
              const bad = meta.ws ? list.filter((e) => audits[e.id]?.approval && !audits[e.id].approval!.ok).length : 0;
              return bad ? <Banner status="warning" title={`승인 서명을 확인할 수 없는 기록 ${bad}건`} description="기록 상세에서 이유를 볼 수 있습니다." /> : null;
            })()}
            <Note>이름과 역할은 각 기기가 스스로 밝힌 값입니다. 서명은 "이 열쇠를 가진 기기가 이 내용을 남겼고 그 뒤로 바뀌지 않았다"를 증명하며, 내용이 사실인지는 증명하지 않습니다.</Note>
          </VStack>
        </Card>
        <Button label="개발자 안내 (에이전트 API)" width="100%" href="/developers" />
        <Sub label="소개 다시 보기" onClick={() => { setErr(""); setDraft({ org: settings.org, submitter: settings.submitter, approver: settings.approver, project: settings.projects[0] ?? "", funder: settings.funder }); go("intro"); }} />
        <Button label="모든 기록 지우고 데모로 초기화" variant="ghost" onClick={() => { window.localStorage.removeItem(STORAGE_KEY); window.localStorage.removeItem(SETTINGS_KEY); loadDemo(); setToast("데모 데이터로 초기화했습니다."); }} />
        <VStack className="grow" />
        <Main label="지출 목록으로" onClick={() => go("list")} />
      </Frame>
    );
  }

  /* ---------- 기록 상세 ---------- */
  if (view === "detail") {
    const e = list.find((x) => x.id === cur.id) ?? cur;
    const rows: [string, string][] = [
      ["지출", `${e.date || "날짜 없음"} · ${e.item || "항목 미입력"} · ${won(e.amount ?? 0)}`],
      ["가맹점", e.merchant || "미입력"],
      ["목적", e.purpose || "미입력"],
      ["사업·행사", `${e.project || "미입력"}${e.budgetCategory ? ` · ${e.budgetCategory}` : ""}`],
      ["결제", `${e.paymentMethod ? PAYMENT_LABEL[e.paymentMethod] : "미입력"}${e.payer ? ` · ${e.payer}` : ""}${e.reimbursement === "needed" ? " · 환급 필요" : ""}`],
      ["증빙", evidenceLabel(e) + (e.evidence.reason ? ` · ${e.evidence.reason}` : "")],
      ["책임", `제출 ${e.submittedBy || "미기록"}${e.approvedBy ? ` · 승인 ${e.approvedBy} (${(e.approvedAt ?? "").slice(0, 10)})` : " · 승인 전"}`],
    ];
    const au = audits[e.id];
    const dev = (x?: { key: string; name: string }) => (x ? `${x.name || "이름 없음"} 기기 · 열쇠 ${x.key.slice(0, 8)}` : "");
    // 혼자 쓰는 기기는 한 기기에서 등록과 승인을 함께 하므로 승인 서명을 따지지 않는다.
    if (meta.ws && au?.approval?.ok) rows.push(["올린 서명", dev(au.approval.submitter)], ["승인 서명", dev(au.approval.by)]);
    else rows.push(["서명", !au ? "확인하는 중" : au.signed ? dev(au.signer) : "지금 내용에 서명한 기기가 없습니다"]);
    return (
      <Frame title="지출 상세" side={STATUS_LABEL[e.status]}>
        {toast ? <Banner status="success" title={toast} /> : null}
        {e.summary ? <Text>{e.summary}</Text> : null}
        <Card padding={3} data-testid="detail">
          <List hasDividers edge="flush" density="compact">
            {rows.map(([k, v]) => <ListItem key={k} label={<Text color="secondary">{k}</Text>} endContent={<Text hasTabularNumbers>{v}</Text>} />)}
          </List>
        </Card>
        {openItems(e).map((o) => <Banner key={o.code} status="warning" title={`확인할 항목: ${o.text}`} />)}
        {dupBanner(e)}
        {meta.ws && au?.approval && !au.approval.ok ? <Banner status="warning" title="승인 서명을 확인할 수 없습니다" description={`${au.approval.text}. 승인자가 자기 기기에서 다시 승인하면 해결됩니다.`} data-testid="approval-audit" /> : null}
        {receiptItems([e]).length ? <ReceiptGallery items={receiptItems([e])} /> : null}
        <Card data-testid="attachments">
          <VStack gap={2}>
            <Heading level={3}>함께 묶은 자료</Heading>
            <Note>거래명세서, 주문내역, 이체확인증처럼 이 지출과 한 거래인 자료를 붙입니다. 지출 건수와 금액은 늘지 않습니다.</Note>
            {e.evidence.extra?.length ? (
              <List hasDividers edge="flush" density="compact">
                {e.evidence.extra.map((a) => <ListItem key={a.id} label={<Text>{a.label}</Text>} endContent={<Button label="떼기" tooltip={`${a.label} 떼기`} size="sm" variant="ghost" onClick={() => removeAttachment(e, a.id)} />} />)}
              </List>
            ) : null}
            <Sub label="자료 붙이기" onClick={() => startAttach(e)} />
          </VStack>
        </Card>
        {e.guidance?.checklist.length ? (
          <Card>
            <VStack gap={2}>
              <Heading level={3}>확인할 자료</Heading>
              <List hasDividers edge="flush">
                {e.guidance.checklist.map((c, i) => (
                  <ListItem key={i} align="start" label={<Text>{c.text}</Text>} endContent={<Button label="출처" size="sm" variant="ghost" href={c.sourceUrl} target="_blank" rel="noreferrer" />} />
                ))}
              </List>
            </VStack>
          </Card>
        ) : null}
        {e.log?.length ? (
          <Card data-testid="history">
            <VStack gap={2}>
              <Heading level={3}>변경 이력</Heading>
              <List hasDividers edge="flush" density="compact">
                {e.log.map((l, i) => <ListItem key={i} align="start" label={<Text>{l.text}</Text>} description={`${l.at.slice(0, 16).replace("T", " ")} · ${l.by || "이름 없음"}`} />)}
              </List>
            </VStack>
          </Card>
        ) : null}
        <VStack className="grow" />
        <Main label="수정" onClick={() => editExisting(e)} />
        {evidenceMissing(e) ? <Sub label="증빙 보완" onClick={() => startFix(e)} /> : null}
        {confirmDelete
          ? <HStack gap={2}><Button label="삭제 확인" variant="destructive" width="100%" onClick={() => removeExpense(e)} /><Sub label="취소" onClick={() => setConfirmDelete(false)} /></HStack>
          : <Sub label="삭제" onClick={() => setConfirmDelete(true)} />}
        <Sub label="지출 목록으로" onClick={() => go("list")} />
        {e.status === "done" ? <Note>완료된 기록을 수정하거나 자료를 붙이고 떼면 다시 승인받아야 합니다.</Note> : null}
      </Frame>
    );
  }


  /* ---------- 목록 ---------- */
  if (view === "list") {
    return (
      <Frame title="열린영수증" side={`${settings.org ? settings.org + " · " : ""}${SUBMITTER}`}>
        {list.length === 0 && !settings.onboarded ? (
          <EmptyState
            title="아직 기록이 없습니다"
            description="영수증만 올리면 에이전트가 기록을 채우고, 모르는 것만 여쭙니다."
            isCompact
            actions={<>
              <Button label="+ 첫 지출 추가" variant="primary" onClick={startAdd} />
              <Button label="데모 데이터 불러오기" onClick={loadDemo} />
            </>}
          />
        ) : (
          <>
            <Selector id="project" label="사업·행사" options={projects.map((p) => ({ value: p, label: p }))} value={project} onChange={(v) => { if (v) { setProject(v); resetClose(); } }} />
            <HStack gap={2}>
              <Stat label="지출" value={`${mine.length}건`} />
              <Stat label="합계" value={won(totalAmount(mine))} />
              <Stat label="보완" value={`${attention.length}건`} />
            </HStack>
            {mine.length === 0 ? <Note>이 사업에는 아직 기록이 없습니다.</Note> : <Rows items={mine} onOpen={openDetail} dup={dupIds} />}
            {toast ? <Banner status="info" title={toast} /> : null}
            {meta.ws ? (
              <HStack gap={2} align="center" justify="between" data-testid="sync-status" data-sync-count={syncCount}>
                <Text type="supporting" color="secondary">{syncing ? "단체 공간과 맞추는 중…" : syncNote || (meta.syncedAt ? `단체 공간 · ${new Date(meta.syncedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 동기화` : "단체 공간 연결됨")}</Text>
                <Button label="동기화" size="sm" variant="ghost" isDisabled={syncing} onClick={() => doSync()} />
              </HStack>
            ) : null}
            <VStack className="grow" />
            {draftsReady > 0 ? <Sub label={`초안 ${draftsReady}건 한꺼번에 확정`} onClick={confirmDrafts} /> : null}
            <Main label="+ 지출 추가" onClick={startAdd} />
            <Sub label="영수증 여러 장 올리기" onClick={() => { setErr(""); setBulkMask(null); resetGroup(); go("bulk"); }} />
            <HStack gap={2}>
              <Sub label="검토 목록" onClick={() => go("review")} />
              <Sub label="결산보고서" onClick={() => go("report")} />
            </HStack>
            <Button label="설정" variant="ghost" onClick={() => { setErr(""); go("settings"); }} />
          </>
        )}
      </Frame>
    );
  }

  /* ---------- 검토 ---------- */
  if (view === "review") {
    return (
      <Frame title="검토" side={`${settings.role === "approver" ? "승인자" : "대표"} ${APPROVER}`}>
        <Text type="supporting" color="secondary">{project}</Text>
        <Rows items={mine} onOpen={openDetail} dup={dupIds} />
        {toast ? <Banner status="success" title={toast} /> : null}
        {mine.some((e) => dupIds.has(e.id)) ? <Banner status="warning" title={`같은 영수증일 수 있는 기록 ${mine.filter((e) => dupIds.has(e.id)).length}건`} description="날짜와 금액이 같은 기록입니다. 목록에서 '중복 확인' 표시가 있는 건을 열어 확인해 주세요." data-testid="dup-review" /> : null}
        {groupCard}
        <Card>
          <VStack gap={2}>
            <Heading level={2}>마감 전 체크 · 보완이 필요한 {attention.length}건</Heading>
            {attention.length === 0 ? <Note>모든 기록이 승인까지 끝났습니다.</Note> : (
              <List hasDividers edge="flush">
                {attention.map((e) => (
                  <ListItem
                    key={e.id}
                    label={`${e.item} ${won(e.amount ?? 0)}`}
                    description={openItems(e).map((o) => o.text).join(" · ")}
                    endContent={e.status === "pending_approval"
                      ? (approvalBlock(e, ME) ? <Text type="supporting" color="secondary" data-testid="no-approve">{approvalBlock(e, ME)}</Text> : <Button label="승인" size="sm" onClick={() => approve(e)} />)
                      : e.status === "draft"
                        ? <Button label="수정" size="sm" onClick={() => editExisting(e)} />
                        : <Button label="보완" size="sm" onClick={() => startFix(e)} />}
                  />
                ))}
              </List>
            )}
          </VStack>
        </Card>
        <Card>
          <VStack gap={3}>
            <Heading level={2}>마감 점검 에이전트</Heading>
            {closePhase === "idle" ? <Note>기록을 모두 훑어, 보완이 필요한 건마다 보낼 요청 문안과 브리핑을 준비합니다. 메시지를 보내지는 않습니다.</Note> : null}
            {closeSteps.length > 0 || closePhase === "running" ? <Log items={closeSteps} running={closePhase === "running"} /> : null}
            {closeErr ? <Banner status="error" title={closeErr} /> : null}
            {closeOut ? <>
              <Card variant="muted" padding={3} data-testid="briefing"><Text>{closeOut.briefing}</Text></Card>
              {closeOut.requests.map((r) => (
                <VStack key={r.id} gap={1.5}>
                  <Text weight="semibold">{r.item} {won(r.amount)} · 받는 사람 {r.to}</Text>
                  <Card variant="muted" padding={3} data-testid="request"><Text className="req">{r.message}</Text></Card>
                  <Button label={copied === r.id ? "복사했습니다" : "문안 복사"} size="sm" onClick={() => copy(r.id, r.message)} />
                </VStack>
              ))}
            </> : null}
            <Sub label={closePhase === "running" ? "점검하는 중…" : closeOut ? "다시 점검" : "마감 점검 맡기기"} isDisabled={closePhase === "running" || mine.length === 0} onClick={runClose} />
          </VStack>
        </Card>
        <Note>승인과 환급 결정은 담당자가 합니다. 열린영수증은 확인할 항목만 알려 드립니다.</Note>
        <VStack className="grow" />
        <Main label="결산보고서 보기" onClick={() => go("report")} />
        <Sub label="지출 목록으로" onClick={() => go("list")} />
      </Frame>
    );
  }

  /* ---------- 결산보고서 ---------- */
  if (view === "report") {
    const r = buildReport(list, project);
    return (
      <Frame title={`${project} 결산보고서 초안`} side={`지출 기간 ${r.period}`} wide>
        {r.openItems.length > 0 ? <VStack className="noprint"><Banner status="warning" title={`확인할 항목이 ${r.openItems.length}건 남아 있습니다.`} description="그대로 내보낼 수 있지만 보고서에 표시됩니다." /></VStack> : null}
        <ReportBody r={r} />
        <Heading level={2}>8. 영수증</Heading>
        <Note>가린 사진은 AI와 후원자에게 보이는 사진입니다. 원본은 등록자와 승인자만 볼 수 있습니다. 내려받는 보고서 파일에는 가린 사진이 함께 들어갑니다.</Note>
        <ReceiptGallery key={project} items={receiptItems(mine)} />
        <Heading level={2}>9. 변조 확인용 지문</Heading>
        <Card padding={3} data-testid="proof">
          <List hasDividers edge="flush" density="compact">
            <ListItem label={<Text color="secondary">보고서 지문</Text>} endContent={<Text id="report-print" hasTabularNumbers weight="semibold">{reportPrint ? shortPrint(reportPrint) : "계산하는 중"}</Text>} />
            <ListItem label={<Text color="secondary">원장 지문</Text>} endContent={<Text hasTabularNumbers>{ledSum ? shortPrint(ledSum.head) : "계산하는 중"}</Text>} />
            <ListItem label={<Text color="secondary">서명</Text>} endContent={<Text>{ledSum ? `${ledSum.entries}줄 · 기기 ${ledSum.devices}대` : ""}</Text>} />
          </List>
        </Card>
        <Note>보고서 지문은 이 사업의 기록이 하나라도 바뀌면 달라집니다. 보고서를 보낼 때 지문을 함께 알려 두면, 받은 분이 나중에 같은 지문인지 견줘 볼 수 있습니다.</Note>
        <HStack gap={2} className="noprint">
          <Main label="CSV 내려받기" onClick={() => download(`${project}_지출내역.csv`, toCsv(mine), "text/csv;charset=utf-8")} />
          <Sub label="보고서 내려받기" onClick={() => download(`${project}_결산보고서_초안.html`, reportToHtml(r, reportPhotos(list, project)), "text/html;charset=utf-8")} />
        </HStack>
        <VStack className="noprint">
          <Card>
            <VStack gap={3}>
              <Heading level={2}>보고서 공유</Heading>
              <Note>보고서 내용을 링크에 담아 보냅니다. 서버에 저장하지 않으며, 링크를 가진 사람은 누구나 볼 수 있습니다. 이 링크에는 영수증 사진이 들어가지 않습니다. 후원자에게 가린 영수증까지 보여 주려면 설정의 단체 공간에서 후원자용 보기 링크를 만드세요.</Note>
              <SegmentedControl label="공유 범위" layout="fill" value={share.rows} onChange={(v) => setShare((sh) => ({ ...sh, rows: v, link: "", note: "" }))}>
                <SegmentedControlItem value="rows" label="지출 내역 포함" />
                <SegmentedControlItem value="summary" label="요약만" />
              </SegmentedControl>
              <SegmentedControl label="이름 표시" layout="fill" value={share.names} onChange={(v) => setShare((sh) => ({ ...sh, names: v, link: "", note: "" }))}>
                <SegmentedControlItem value="hide" label="이름 가림" />
                <SegmentedControlItem value="show" label="이름 표시" />
              </SegmentedControl>
              <Sub label="공유 링크 만들기" isDisabled={r.count === 0} onClick={makeShareLink} />
              {share.link ? <>
                <TextInput id="share-link" label="공유 링크" isReadOnly value={share.link} onChange={() => {}} />
                <HStack gap={2}>
                  <Main label="링크 복사" onClick={copyShare} />
                  {typeof navigator !== "undefined" && "share" in navigator ? <Sub label="공유하기" onClick={nativeShare} /> : null}
                  <Button label="열어 보기" width="100%" href={share.link} target="_blank" rel="noreferrer" />
                </HStack>
              </> : null}
              {share.note ? <Note>{share.note}</Note> : null}
              {meta.ws && settings.sponsorView && viewerLink ? <>
                <TextInput id="report-viewer-link" label="영수증 사진까지 보이는 링크 (후원자용 보기)" isReadOnly value={viewerLink} onChange={() => {}}
                  description="결산보고서와 가린 영수증·거래명세서 사진을 함께 보여 줍니다. 원본과 이름은 보이지 않습니다." />
                <Sub label="후원자용 링크 복사" onClick={() => { navigator.clipboard?.writeText(viewerLink).then(() => setShare((sh) => ({ ...sh, note: "후원자용 보기 링크를 복사했습니다." })), () => {}); }} />
              </> : null}
            </VStack>
          </Card>
        </VStack>
        <HStack gap={2} className="noprint">
          <Sub label="인쇄" onClick={() => window.print()} />
          <Sub label="검토 목록으로" onClick={() => go("review")} />
          <Sub label="지출 목록으로" onClick={() => go("list")} />
        </HStack>
      </Frame>
    );
  }

  /* ---------- 지출 추가 ---------- */
  const title: Record<Step, string> = { upload: "지출 추가", alt: "대체 증빙", mask: "가릴 부분 확인", agent: phase === "done" ? "증빙 묶음" : "에이전트가 정리 중", edit: "직접 입력", saved: "저장 완료", attach: "자료 붙이기" };
  const ai = (k: string) => (cur.aiDrafted.includes(k) ? "AI가 채운 초안입니다. 틀리면 고쳐 주세요." : undefined);
  const text = (k: "date" | "merchant" | "item" | "purpose" | "project" | "budgetCategory" | "payer", label: string, placeholder = "", id = `f-${k}`) => (
    <TextInput id={id} label={label} value={cur[k]} placeholder={placeholder} description={ai(k)} onChange={(v) => set(k, v)} />
  );
  const dateField = (
    <DateInput id="f-date" label="일자" placeholder="날짜 선택" value={/^\d{4}-\d{2}-\d{2}$/.test(cur.date) ? (cur.date as any) : undefined} description={ai("date")}
      onChange={(v) => set("date", v ?? "")} />
  );
  const amountField = (
    <TextInput id="f-amount" label="금액 (원)" inputMode="numeric" value={cur.amount == null ? "" : String(cur.amount)} description={ai("amount")}
      onChange={(v) => { const d = v.replace(/[^\d]/g, ""); set("amount", d === "" ? null : Number(d)); }} />
  );
  const payField = (
    <Selector id="f-pay" label="결제 방식" placeholder="선택" options={PAY_OPTIONS} value={cur.paymentMethod ?? undefined} description={ai("paymentMethod")}
      onChange={(v) => set("paymentMethod", (v || null) as PaymentMethod | null)} />
  );
  const reimbField = (
    <VStack gap={2}>
      {text("payer", "결제자", "예: 김○○", "q-payer")}
      <SegmentedControl label="환급 여부" layout="fill" value={cur.reimbursement} onChange={(v) => set("reimbursement", v as Expense["reimbursement"])}>
        <SegmentedControlItem value="needed" label="환급 필요" />
        <SegmentedControlItem value="not_needed" label="필요 없음" />
      </SegmentedControl>
    </VStack>
  );
  function askControl(f: string) {
    if (f === "project") return (
      <VStack gap={2}>
        <HStack gap={2} wrap="wrap">{projects.filter(Boolean).slice(0, 2).map((p) => <Button key={p} label={p} size="sm" variant={cur.project === p ? "primary" : "secondary"} onClick={() => set("project", p)} />)}</HStack>
        <TextInput id="q-project" label="사업·행사 이름" isLabelHidden value={cur.project} placeholder="직접 입력" onChange={(v) => set("project", v)} />
      </VStack>
    );
    if (f === "reimbursement" || f === "payer") return reimbField;
    if (f === "purpose") return <TextInput id="q-purpose" label="목적" isLabelHidden value={cur.purpose} placeholder="예: 워크숍 다과 구매" onChange={(v) => set("purpose", v)} />;
    if (f === "budgetCategory") return <TextInput id="q-budget" label="예산 항목" isLabelHidden value={cur.budgetCategory} placeholder="예: 회의·행사비" onChange={(v) => set("budgetCategory", v)} />;
    if (f === "amount") return amountField;
    if (f === "paymentMethod") return payField;
    if (f === "date") return dateField;
    if (f === "merchant") return text("merchant", "가맹점");
    return text("item", "항목", "예: 행사 다과");
  }
  // 지금 올리는 서류가 이미 있는 기록과 같은 거래로 보이면, 새 지출 대신 그 기록의 자료로 붙일 수 있다.
  const dupTarget = !list.some((x) => x.id === cur.id) && groupable(cur) ? findDuplicates(cur, list).find((x) => !x.approvedBy) : undefined;
  const bundleRows: [string, string][] = [
    ["영수증", cur.evidence.kind === "receipt" && cur.evidence.image ? "첨부됨 (가림 처리)" : cur.evidence.kind === "alternative" ? `대체: ${cur.evidence.altType}` : "없음"],
    ["지출", `${md(cur.date)} · ${cur.item || "항목 미입력"} · ${won(cur.amount ?? 0)}`],
    ["목적", cur.purpose || "미입력"],
    ["사업·행사", `${cur.project || "미입력"}${cur.budgetCategory ? ` · ${cur.budgetCategory}` : ""}`],
    ["결제", `${cur.paymentMethod ? PAYMENT_LABEL[cur.paymentMethod] : "미입력"}${cur.payer ? ` · ${cur.payer}` : ""}${cur.reimbursement === "needed" ? " · 환급 필요" : ""}`],
    ["책임", `제출 ${SUBMITTER} · 승인 전`],
  ];

  /** 사진 위에 가림 상자를 그리는 판. 영수증 가리기와 자료 붙이기가 함께 쓴다. */
  const maskPad = raw ? <>
        <div className="maskwrap" aria-label="영수증 미리보기. 끌어서 가릴 영역을 그립니다."
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = pos(e); }}
          onPointerMove={(e) => { if (drag.current) setDragBox(boxOf(drag.current, pos(e))); }}
          onPointerUp={(e) => { if (drag.current) { const b = boxOf(drag.current, pos(e)); if (b.w > 0.02 && b.h > 0.01) setBoxes((bs) => [...bs, b]); } drag.current = null; setDragBox(null); }}>
          <img src={raw} alt="영수증" />
          {[...boxes, ...(dragBox ? [dragBox] : [])].map((b, i) => <i key={i} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} />)}
        </div>
        <HStack gap={2}>
          <Sub label="가림 상자 추가" onClick={() => setBoxes((bs) => [...bs, { x: 0.1, y: 0.45, w: 0.8, h: 0.06 }])} />
          <Sub label="되돌리기" isDisabled={!boxes.length} onClick={() => setBoxes((bs) => bs.slice(0, -1))} />
        </HStack>
  </> : null;

  return (
    <Frame title={title[step]} side={step === "agent" && phase !== "done" ? "Liner" : undefined}>
      {err ? <Banner status="error" title={err} /> : null}

      {step === "upload" ? <>
        <input ref={fileRef} id="file" type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        {raw
          ? <VStack className="maskwrap static"><img src={raw} alt="올린 영수증 미리보기" /></VStack>
          : <Card variant="muted" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
              <EmptyState title="영수증 사진" description="사진을 끌어다 놓거나 아래에서 선택하세요." isCompact />
            </Card>}
        <HStack gap={2}>
          <Sub label={raw ? "다른 사진 선택" : "사진 선택"} onClick={() => fileRef.current?.click()} />
          <Sub label="가상 영수증 사용" onClick={useDemoReceipt} />
        </HStack>
        <Button label="영수증이 없어요" variant="ghost" onClick={() => { setCur((c) => withStatus({ ...c, evidence: { kind: "alternative", altType: "이체확인증" } })); setStep("alt"); }} />
        <TextArea id="memo" label="메모 (선택)" value={memo} placeholder="예: 간식 샀어요" onChange={(v) => setMemo(v)} />
        <VStack className="grow" />
        <Main label="다음: 가릴 부분 확인" isDisabled={!raw} onClick={() => { setErr(""); setStep("mask"); }} />
        <Sub label="취소" onClick={() => go("list")} />
      </> : null}

      {step === "alt" ? <>
        {editing ? <Card variant="muted" padding={3}><Text weight="semibold">{cur.item} {won(cur.amount ?? 0)} · {md(cur.date)}</Text></Card> : null}
        <Selector id="alt-type" label="대체 자료 종류" options={ALT_OPTIONS} value={cur.evidence.altType ?? "이체확인증"}
          onChange={(v) => setCur((c) => withStatus({ ...c, evidence: { ...c.evidence, kind: "alternative", altType: v ?? "이체확인증" } }))} />
        <TextArea id="alt-reason" label="영수증이 없는 사유" value={cur.evidence.reason ?? ""} placeholder="예: 현장 현금 결제로 영수증 미발급"
          description="비워 두면 증빙 보완으로 저장되고, 검토 목록에 다음 행동이 표시됩니다."
          onChange={(v) => setCur((c) => withStatus({ ...c, evidence: { ...c.evidence, kind: "alternative", altType: c.evidence.altType ?? "이체확인증", reason: v } }))} />
        {!editing ? <TextArea id="memo-alt" label="메모" description="무엇에 얼마를 썼는지 적어 주세요." value={memo} placeholder="예: 강사 교통비 12,500원 계좌이체" onChange={(v) => setMemo(v)} /> : null}
        <VStack className="grow" />
        {editing
          ? <><Main label="저장" onClick={saveFix} /><Sub label="취소" onClick={() => go("review")} /></>
          : <><Main label="에이전트에게 맡기기" onClick={startAgent} /><Sub label="직접 입력" onClick={() => { setErr(""); setStep("edit"); }} /></>}
      </> : null}

      {step === "mask" && raw ? <>
        {maskPad}
        <Note>이름·카드번호 위를 끌어서 가려 주세요. 가린 상자 {boxes.length}개. 메모 속 카드번호·전화번호는 자동으로 가려집니다.</Note>
        <Note>AI에는 가린 사진만 보냅니다. 원본은 이 기기에 보관하고, 단체 공간을 쓰면 암호화해 등록자와 승인자만 볼 수 있습니다. 후원자에게는 가린 사진만 보입니다.</Note>
        <VStack className="grow" />
        <Main label="에이전트에게 맡기기" onClick={startAgent} />
        <Sub label="이전" onClick={() => setStep("upload")} />
      </> : null}

      {step === "agent" ? <>
        {steps.length > 0 || phase === "running" ? <Log items={steps} running={phase === "running"} /> : null}

        {phase === "ask" ? <>
          {questions.map((q) => (
            <Card key={q.field} data-testid="question">
              <VStack gap={3}><Heading level={3}>{q.text}</Heading>{askControl(q.field)}</VStack>
            </Card>
          ))}
          <Note>에이전트가 스스로 알 수 없는 것만 여쭙니다. 비워 두고 넘어가도 됩니다.</Note>
          <VStack className="grow" />
          <Main label="답하고 계속" onClick={() => callAgent(cur, { resume: true })} />
          <Sub label="직접 입력으로 전환" onClick={() => setStep("edit")} />
        </> : null}

        {phase === "done" ? <>
          <TextArea id="f-summary" label="한 줄 요약" description={ai("summary")} value={cur.summary} onChange={(v) => set("summary", v)} />
          <Card padding={3} data-testid="bundle">
            <List hasDividers edge="flush" density="compact">
              {bundleRows.map(([k, v]) => <ListItem key={k} label={<Text color="secondary">{k}</Text>} endContent={<Text hasTabularNumbers>{v}</Text>} />)}
            </List>
          </Card>
          {openItems(cur).filter((o) => o.code !== "approval" && o.text !== "내용 확인 후 확정").map((o) => <Banner key={o.code} status="warning" title={`확인할 항목: ${o.text}`} />)}
          {guide.checklist.length > 0 ? (
            <Card>
              <VStack gap={2}>
                <Heading level={3}>확인할 자료</Heading>
                <List hasDividers edge="flush">
                  {guide.checklist.map((c, i) => {
                    const n = guide.sources.findIndex((s) => s.url === c.sourceUrl);
                    const s = guide.sources[n];
                    return (
                      <ListItem key={i} data-testid="check" align="start" label={<Text>{c.text}</Text>}
                        description={s ? <Text type="supporting" color="secondary">{`${s.title} · ${s.hostname} · ${s.date ?? "날짜 미상"}`}</Text> : undefined}
                        endContent={<Button label={`출처 ${n + 1}`} size="sm" variant="ghost" href={c.sourceUrl} target="_blank" rel="noreferrer" />} />
                    );
                  })}
                </List>
              </VStack>
            </Card>
          ) : <Note>이 지출에 연결할 공개 지침은 찾지 못했습니다. 교부 조건 문서를 직접 확인해 주세요.</Note>}
          <Note>판정이 아니라 안내입니다. 내용을 확인하고 확정하는 것은 담당자입니다.</Note>
          {dupBanner(cur)}
          {dupTarget ? <Sub label="기존 기록에 자료로 붙이기" onClick={() => attachToExisting(dupTarget)} /> : null}
          <Main label="내용 확정" onClick={confirm} />
          <Sub label="수정" onClick={() => setStep("edit")} />
        </> : null}

        {phase === "error" ? <>
          <VStack className="grow" />
          <HStack gap={2}>
            <Sub label="다시 시도" onClick={startAgent} />
            <Main label="직접 입력으로 계속" onClick={() => { setErr(""); setStep("edit"); }} />
          </HStack>
        </> : null}
      </> : null}

      {step === "edit" ? <>
        {dateField}
        {amountField}
        {text("merchant", "가맹점")}
        {text("item", "항목", "예: 행사 다과")}
        {payField}
        {text("project", "사업·행사", DEMO_PROJECT)}
        {text("purpose", "목적", "무엇을 위해 썼나요?")}
        {text("budgetCategory", "예산 항목", "예: 회의·행사비")}
        <Card><VStack gap={3}><Heading level={3}>누가 결제했고, 환급이 필요한가요?</Heading>{reimbField}</VStack></Card>
        <TextArea id="f-summary-edit" label="한 줄 요약" description="비워 두면 자동으로 작성합니다." value={cur.summary} onChange={(v) => set("summary", v)} />
        {dupBanner(cur)}
        <Main label="내용 확정" onClick={confirm} />
        {phase === "done" ? <Sub label="증빙 묶음으로 돌아가기" onClick={() => setStep("agent")} /> : null}
      </> : null}

      {step === "saved" ? <>
        <Banner status="success" title={`저장했습니다. ${cur.status === "needs_evidence" ? "증빙 보완이 필요합니다." : cur.status === "draft" ? "필수 정보를 마저 채워 주세요." : "승인자 확인을 기다립니다."}`} />
        <Card data-testid="saved-line">
          <VStack gap={1.5}>
            <Text weight="semibold" hasTabularNumbers>{md(cur.date)} · {cur.item} · {won(cur.amount ?? 0)}</Text>
            <HStack gap={2} align="center" wrap="wrap">
              <Text color="secondary">{cur.paymentMethod ? PAYMENT_LABEL[cur.paymentMethod] : "결제 미입력"} · {cur.evidence.kind === "receipt" ? "영수증 첨부" : cur.evidence.kind === "alternative" ? "대체 증빙" : "증빙 없음"}</Text>
              <Token label={STATUS_LABEL[cur.status]} color={STATUS_COLOR[cur.status]} size="sm" />
            </HStack>
          </VStack>
        </Card>
        {openItems(cur).length > 0 ? (
          <Card><VStack gap={1.5}><Heading level={3}>남은 확인</Heading>{openItems(cur).map((o) => <Text key={o.code}>· {o.text}</Text>)}</VStack></Card>
        ) : null}
        <VStack className="grow" />
        <Main label="검토 목록 보기" onClick={() => go("review")} />
        <Sub label="거래명세서 등 자료 붙이기" onClick={() => startAttach(cur)} />
        <Sub label="지출 하나 더 추가" onClick={startAdd} />
      </> : null}

      {step === "attach" ? <>
        <Card variant="muted" padding={3}><Text weight="semibold" hasTabularNumbers>{md(cur.date)} · {cur.item || "항목 미입력"} · {won(cur.amount ?? 0)}</Text></Card>
        <Note>이 지출과 한 거래인 자료를 붙입니다. 새 지출이 생기지 않고, 영수증과 함께 한 건으로 묶입니다.</Note>
        <Selector id="att-label" label="자료 종류" options={ATTACH_OPTIONS} value={attLabel} onChange={(v) => setAttLabel(v || ATTACH_LABELS[0])} />
        <input ref={fileRef} id="att-file" type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        {raw ? <>
          {maskPad}
          <Note>이름·주소·전화번호 위를 끌어서 가려 주세요. 가린 상자 {boxes.length}개. 후원자에게는 가린 사진만 보이고, 원본은 등록자와 승인자만 봅니다. 이 자료는 AI에 보내지 않습니다.</Note>
        </> : (
          <Card variant="muted" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
            <EmptyState title="자료 사진" description="거래명세서나 주문내역을 찍은 사진, 화면을 캡처한 그림을 선택하세요." isCompact />
          </Card>
        )}
        <Sub label={raw ? "다른 사진 선택" : "사진 선택"} onClick={() => fileRef.current?.click()} />
        <VStack className="grow" />
        <Main label="이 지출에 붙이기" isDisabled={!raw} onClick={saveAttach} />
        <Sub label="취소" onClick={() => { setRaw(null); go("detail"); }} />
      </> : null}
    </Frame>
  );
}
