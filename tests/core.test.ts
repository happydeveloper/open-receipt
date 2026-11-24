// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 기기 안에서 끝나는 규칙: 저장, 상태 계산, 가림, 에이전트 결과 반영, 판정 표현 걸러내기,
 * CSV와 결산보고서, 승인 규칙과 중복 경고. T-번호는 테스트문서의 항목 번호다.
 */
import { describe, expect, it } from "vitest";
import { approvalBlock, approveExpense, confirmExpense, duplicateIds, findDuplicates, newExpense, openItems, needsAttention, reconfirmExpense } from "@/lib/status";
import { fillBoxes, fitWithin, maskText } from "@/lib/mask";
import { softenJudgment } from "@/lib/guard";
import { applyAgentRecord, editField, lockedFields, recordValues } from "@/lib/flow";
import { hydrateImages, LOCAL_IMAGE, loadExpenses, resetToSeed, saveExpenses, type KV } from "@/lib/storage";
import { memoryBag } from "@/lib/originals";
import { demoSnackExpense, seedExpenses, DEMO_PROJECT, APPROVER } from "@/lib/seed";
import { BOM, toCsv, totalAmount } from "@/lib/csv";
import { buildReport, reportToHtml } from "@/lib/report";

function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
describe("저장과 상태 규칙", () => {
  it("T-01 저장 후 다시 읽으면 모든 필드가 같다", () => {
    const kv = memoryKV();
    const list = [...seedExpenses(), demoSnackExpense()];
    expect(saveExpenses(kv, list)).toBe(true);
    expect(loadExpenses(kv)).toEqual(list);
  });
  it("사진은 큰 보관함에 따로 두고 목록에는 표시만 남긴다 (여러 장을 올려도 저장 공간이 차지 않게)", async () => {
    const kv = memoryKV();
    const photos = memoryBag();
    const photo = "data:image/jpeg;base64," + "A".repeat(50_000);
    const list = Array.from({ length: 30 }, (_, i) => newExpense({ id: `e${i}`, item: `영수증 ${i}`, evidence: { kind: "receipt", image: photo } }));
    expect(saveExpenses(kv, list, photos)).toBe(true);
    expect(kv.getItem("open-receipt:v1")!.length).toBeLessThan(30_000); // 사진 30장(1.5MB)이 목록에는 들어가지 않는다
    expect(photos.data.size).toBe(30);
    const loaded = loadExpenses(kv)!;
    expect(loaded[0].evidence.image).toBe(LOCAL_IMAGE);
    expect(loaded[0].status).toBe(list[0].status); // 표시만 있어도 증빙이 있는 것으로 본다
    const full = await hydrateImages(loaded, photos);
    expect(full.map((e) => e.evidence.image)).toEqual(list.map(() => photo));
    // 시드의 작은 자리표시 이미지는 그대로 둔다
    saveExpenses(kv, seedExpenses(), photos);
    expect(loadExpenses(kv)![0].evidence.image).not.toBe(LOCAL_IMAGE);
  });
  it("T-02 증빙도 사유도 없으면 증빙 보완 + 다음 행동 안내", () => {
    const e = newExpense({ date: "2026-11-19", item: "교통비", amount: 12500, project: DEMO_PROJECT, paymentMethod: "transfer", confirmed: true });
    expect(e.status).toBe("needs_evidence");
    expect(openItems(e).map((o) => o.text)).toContain("이체확인증 또는 대체 증빙 첨부");
  });
  it("T-03 대체 증빙에 사유가 있으면 증빙 보완이 아니다", () => {
    const e = newExpense({
      date: "2026-11-19", item: "교통비", amount: 12500, project: DEMO_PROJECT, paymentMethod: "transfer", confirmed: true,
      evidence: { kind: "alternative", altType: "사유서", reason: "현장 현금 결제로 영수증 미발급" },
    });
    expect(e.status).toBe("pending_approval");
  });
  it("T-15 에이전트 결과 반영만으로는 상태가 바뀌지 않고, 확정·승인은 사람의 행동으로만 일어난다", () => {
    let e = newExpense({ evidence: { kind: "receipt", image: "data:image/jpeg;base64,AAAA" } });
    e = applyAgentRecord(e, { date: "2026-11-18", amount: 26400, item: "행사 다과", paymentMethod: "personal", project: DEMO_PROJECT }, ["date", "amount", "item", "paymentMethod", "project"], "요약");
    expect(e.status).toBe("draft");
    expect(e.confirmed).toBe(false);
    expect(approveExpense(e, APPROVER)).toBe(e); // 확정 전에는 승인 불가
    e = confirmExpense(e, "김○○");
    expect(e.status).toBe("pending_approval");
    e = approveExpense(e, APPROVER, "2026-11-20T00:00:00.000Z");
    expect(e.status).toBe("done");
    expect(e.approvedBy).toBe(APPROVER);
  });
});

describe("민감정보 가림", () => {
  it("T-04 메모의 카드번호·전화번호를 가린다", () => {
    const out = maskText("카드 1234-5678-9012-3456, 연락처 010-1234-5678 간식 26,400원");
    expect(out).not.toContain("1234-5678-9012-3456");
    expect(out).not.toContain("010-1234-5678");
    expect(out).toContain("[카드번호 가림]");
    expect(out).toContain("[전화번호 가림]");
    expect(out).toContain("26,400원");
    expect(maskText("1234567890123456")).toBe("[카드번호 가림]");
  });
  it("T-05 가림 상자 영역은 단색이 되고 이미지는 긴 변 1600px 이하로 줄어든다", () => {
    expect(fitWithin(4000, 3000)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(1200, 3200)).toEqual({ w: 600, h: 1600 });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
    const w = 10, h = 10;
    const data = new Uint8ClampedArray(w * h * 4).fill(200);
    fillBoxes(data, w, h, [{ x: 0.2, y: 0.2, w: 0.4, h: 0.3 }]);
    const px = (x: number, y: number) => [...data.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
    for (let y = 2; y < 5; y++) for (let x = 2; x < 6; x++) expect(px(x, y)).toEqual([0, 0, 0, 255]);
    expect(px(0, 0)).toEqual([200, 200, 200, 200]);
    expect(px(7, 7)).toEqual([200, 200, 200, 200]);
  });
});

describe("에이전트 결과 반영", () => {
  it("T-06 에이전트가 채운 필드에 AI 초안 표시가 붙는다", () => {
    const e = applyAgentRecord(newExpense(), { date: "2026-11-18", amount: 26400, merchant: "○○마트", item: "행사 다과", paymentMethod: "personal" }, ["date", "amount", "merchant", "item", "paymentMethod"]);
    expect(e).toMatchObject({ amount: 26400, date: "2026-11-18", paymentMethod: "personal" });
    expect(e.aiDrafted).toEqual(expect.arrayContaining(["date", "amount", "merchant", "item", "paymentMethod"]));
    expect(lockedFields(e)).toEqual([]);
  });
  it("사람이 넣은 값은 잠기고, 고치면 AI 초안 표시가 사라진다", () => {
    let e = applyAgentRecord(newExpense({ item: "다과" }), { item: "간식 구입", amount: 26400 }, ["item", "amount"]);
    expect(e.item).toBe("다과");
    expect(lockedFields(e)).toEqual(["item"]);
    e = editField(e, "amount", 26000);
    expect(e.aiDrafted).not.toContain("amount");
    expect(lockedFields(e).sort()).toEqual(["amount", "item"]);
  });
  it("에이전트에 보낼 값에서 빈 값과 미확인 환급은 뺀다", () => {
    expect(recordValues(newExpense({ item: "다과", amount: 1000 }))).toEqual({ item: "다과", amount: 1000 });
    expect(recordValues(newExpense({ reimbursement: "needed" }))).toEqual({ reimbursement: "needed" });
  });
});

describe("가드레일", () => {
  it("T-11 판정 표현은 '확인이 필요합니다'로 바뀐다", () => {
    const r = softenJudgment("영수증에 금액이 보입니다. 이 지출은 규정 위반입니다. 부적법한 집행입니다.");
    expect(r.text).not.toMatch(/위반|부적법|적법|불법/);
    expect(r.text).toContain("확인이 필요합니다.");
    expect(r.text).toContain("영수증에 금액이 보입니다.");
    expect(r.count).toBe(2);
    expect(softenJudgment("환급 이체 확인증을 보관하세요.")).toEqual({ text: "환급 이체 확인증을 보관하세요.", count: 0 });
  });
});

describe("검토·내보내기·결산보고서", () => {
  const all = () => [...seedExpenses(), demoSnackExpense()];
  it("T-16 마감 전 체크에 보완 2건(교통비, 행사 다과)", () => {
    const att = needsAttention(all());
    expect(att.map((e) => e.item).sort()).toEqual(["교통비", "행사 다과"]);
    const snack = att.find((e) => e.item === "행사 다과")!;
    expect(openItems(snack).map((o) => o.text)).toEqual(["환급 여부와 승인자 확인"]);
  });
  it("T-17 CSV: 데이터 3행, 합계 56900, BOM 포함", () => {
    const csv = toCsv(all());
    expect(csv.startsWith(BOM)).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(1 + 3 + 1);
    expect(lines[0].split(",")[0]).toBe("날짜");
    expect(lines[4].split(",").slice(0, 3)).toEqual(["합계", "", "56900"]);
    expect(totalAmount(all())).toBe(56900);
    expect(toCsv([newExpense({ item: '쉼표, "따옴표"' })])).toContain('"쉼표, ""따옴표"""');
  });
  it("T-18 초기화하면 시드 초기 상태로 복원", () => {
    const kv = memoryKV();
    saveExpenses(kv, [demoSnackExpense()]);
    const seed = resetToSeed(kv);
    expect(seed).toEqual(seedExpenses());
    expect(loadExpenses(kv)).toEqual(seedExpenses());
    expect(seed.map((e) => e.status)).toEqual(["done", "needs_evidence"]);
  });
  it("결산보고서: 합계·항목별·결제별·확인할 항목·환급 대상", () => {
    const r = buildReport([...all(), newExpense({ project: "다른 사업", amount: 999 })], DEMO_PROJECT, "2026-11-24T00:00:00.000Z");
    expect(r.count).toBe(3);
    expect(r.total).toBe(56900);
    expect(r.approvedTotal).toBe(18000);
    expect(r.period).toBe("2026-11-18 ~ 2026-11-19");
    expect(r.byCategory.reduce((s, g) => s + g.amount, 0)).toBe(56900);
    expect(r.byPayment.find((g) => g.name === "개인 선결제")?.amount).toBe(26400);
    expect(r.openItems.map((o) => o.text)).toEqual(expect.arrayContaining(["이체확인증 또는 대체 증빙 첨부", "환급 여부와 승인자 확인"]));
    expect(r.reimbursements).toEqual([{ payer: "김○○", item: "행사 다과", amount: 26400, approved: false }]);
    const html = reportToHtml(r);
    expect(html).toContain("56,900원");
    expect(html).toContain("결산보고서 초안");
    expect(html).not.toMatch(/위반|부적법|불법/);
  });
  it("T-24 근거가 저장된 기록의 보고서에 출처 제목·URL·검색 시각 포함", () => {
    const snack = {
      ...demoSnackExpense(),
      guidance: {
        query: "q",
        searchedAt: "2026-11-23T03:00:00.000Z",
        sources: [
          { title: "보조금 정산 안내", url: "https://example.org/a", hostname: "example.org", date: "2026-04-15", description: "" },
          { title: "쓰이지 않은 출처", url: "https://example.org/b", hostname: "example.org", date: null, description: "" },
        ],
        checklist: [{ text: "환급 이체 확인증 보관", sourceUrl: "https://example.org/a" }],
      },
    };
    const r = buildReport([snack], DEMO_PROJECT);
    expect(r.sources).toEqual([{ title: "보조금 정산 안내", url: "https://example.org/a", date: "2026-04-15", searchedAt: "2026-11-23T03:00:00.000Z" }]);
    expect(reportToHtml(r)).toContain("https://example.org/a");
  });
});

describe("여러 사람이 함께 쓸 때", () => {
  const pending = (over = {}) =>
    confirmExpense(newExpense({ id: "p1", date: "2026-11-20", amount: 9000, item: "현수막 끈", merchant: "다온문구", project: "워크숍", paymentMethod: "cash", evidence: { kind: "alternative", reason: "영수증 미발급" }, ...over }), "김다온");

  it("단체 공간에서는 승인자 역할만 승인하고, 자기가 올린 지출은 승인하지 못한다", () => {
    const e = pending();
    expect(approvalBlock(e, { name: "김다온", role: "submitter", shared: false })).toBeNull(); // 혼자 쓰는 기기
    expect(approvalBlock(e, { name: "이등록", role: "submitter", shared: true })).toBe("승인자가 승인합니다");
    expect(approvalBlock(e, { name: "김다온", role: "approver", shared: true })).toBe("내가 올린 지출은 다른 승인자가 승인합니다");
    expect(approvalBlock(e, { name: " 박승인 ", role: "approver", shared: true })).toBeNull();
    expect(approvalBlock(newExpense({ id: "d" }), { name: "박승인", role: "approver", shared: true })).not.toBeNull(); // 승인 대기가 아님
  });
  it("승인과, 승인된 기록을 고쳐 승인이 풀린 일이 이력에 남는다", () => {
    const approved = approveExpense(pending(), "박승인", "2026-11-21T00:00:00.000Z");
    expect(approved.log).toEqual([{ at: "2026-11-21T00:00:00.000Z", by: "박승인", text: "승인했습니다" }]);
    const edited = reconfirmExpense({ ...approved, amount: 12000, approvedBy: undefined, approvedAt: undefined, confirmed: false }, "김다온", approved, "2026-11-22T00:00:00.000Z");
    expect(edited.status).toBe("pending_approval");
    expect(edited.log).toHaveLength(2);
    expect(edited.log![1]).toEqual({ at: "2026-11-22T00:00:00.000Z", by: "김다온", text: "승인된 기록을 고쳐 승인이 풀렸습니다 (이전 승인: 박승인)" });
    // 승인된 적 없는 기록을 고치면 이력을 늘리지 않는다
    expect(reconfirmExpense(pending(), "김다온", pending()).log).toBeUndefined();
  });
  it("날짜와 금액이 같고 가맹점이 같거나 비어 있으면 같은 영수증일 수 있다고 알린다", () => {
    const a = pending();
    const same = pending({ id: "p2", merchant: "(주) 다온 문구", item: "끈" });
    const blank = pending({ id: "p3", merchant: "" });
    const otherShop = pending({ id: "p4", merchant: "한빛마트" });
    const otherDay = pending({ id: "p5", date: "2026-11-21" });
    const otherAmount = pending({ id: "p6", amount: 9500 });
    const list = [a, same, blank, otherShop, otherDay, otherAmount];
    expect(findDuplicates(a, list).map((e) => e.id)).toEqual(["p2", "p3"]);
    expect(findDuplicates(otherShop, list).map((e) => e.id)).toEqual(["p3"]);
    expect(findDuplicates(newExpense({ id: "n" }), list)).toEqual([]); // 날짜·금액이 없으면 견주지 않는다
    expect([...duplicateIds(list)].sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });
});
