// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * 서명 원장: 서명과 사슬 검증, 기기별 원장 합치기, 승인 서명 검증, 지문.
 */
import { describe, expect, it } from "vitest";
import { appendEntry, auditRecord, canonical, createIdentity, diffEntries, ledgerHead, members, mergeLedgers, recordDigest, recordsFingerprint, shortPrint, verifyChain, type Ledger } from "@/lib/ledger";
import { approveExpense, confirmExpense, newExpense } from "@/lib/status";

const draft = (over = {}) =>
  confirmExpense(newExpense({ id: "e1", date: "2026-11-20", amount: 9000, item: "현수막 끈", merchant: "다온문구", project: "워크숍", paymentMethod: "cash", evidence: { kind: "alternative", reason: "영수증 미발급" }, ...over }), "김다온");
const SUB = { name: "김다온", role: "submitter" as const };
const APP = { name: "박승인", role: "approver" as const };

/** 기기가 기록 목록을 바꿨을 때 하는 일: 바뀐 만큼 자기 원장에 서명해 덧붙인다. */
async function sign(ledger: Ledger, me: Awaited<ReturnType<typeof createIdentity>>, who: typeof SUB | typeof APP, prev: any[], next: any[], at: string) {
  for (const input of await diffEntries(prev, next)) ledger = await appendEntry(ledger, me, who, input, at);
  return ledger;
}

describe("서명 원장", () => {
  it("키 순서가 달라도 같은 내용이면 같은 해시가 된다", async () => {
    expect(canonical({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    const e = draft();
    expect(await recordDigest(e)).toBe(await recordDigest({ ...e, updatedAt: "x", log: [], summary: "다른 요약" } as any));
    expect(await recordDigest(e)).not.toBe(await recordDigest({ ...e, amount: 9001 }));
  });

  it("기록을 올리고 고치고 지우면 내 원장에 서명된 줄이 이어진다", async () => {
    const me = await createIdentity();
    const e = draft();
    let ledger = await sign({}, me, SUB, [], [e], "2026-11-20T01:00:00.000Z");
    ledger = await sign(ledger, me, SUB, [e], [{ ...e, amount: 12000 }], "2026-11-20T02:00:00.000Z");
    ledger = await sign(ledger, me, SUB, [{ ...e, amount: 12000 }], [{ ...e, amount: 12000, updatedAt: "바뀐 시각" }], "2026-11-20T02:30:00.000Z"); // 내용이 같으면 줄 없음
    ledger = await sign(ledger, me, SUB, [{ ...e, amount: 12000 }], [], "2026-11-20T03:00:00.000Z");
    const chain = ledger[me.key];
    expect(chain.entries.map((x) => [x.seq, x.type])).toEqual([[0, "record"], [1, "record"], [2, "delete"]]);
    expect(chain.entries[0].prev).toBe("");
    expect(chain.entries[1].prev).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyChain(me.key, chain)).toEqual([]);
    expect(JSON.stringify(ledger)).not.toContain(me.priv.d); // 비밀 열쇠는 원장에 들어가지 않는다
  });

  it("줄을 고치거나, 중간을 빼거나, 남의 열쇠로 서명하면 검증에서 드러난다", async () => {
    const me = await createIdentity();
    const other = await createIdentity();
    const e = draft();
    let ledger = await sign({}, me, SUB, [], [e], "2026-11-20T01:00:00.000Z");
    ledger = await sign(ledger, me, SUB, [e], [{ ...e, amount: 12000 }], "2026-11-20T02:00:00.000Z");
    ledger = await sign(ledger, me, SUB, [{ ...e, amount: 12000 }], [{ ...e, amount: 15000 }], "2026-11-20T03:00:00.000Z");
    const chain = ledger[me.key];

    const edited = { ...chain, entries: chain.entries.map((x, i) => (i === 1 ? { ...x, digest: "0".repeat(64) } : x)) };
    expect((await verifyChain(me.key, edited))[0].text).toContain("2번째 줄: 서명이 맞지 않습니다");
    const renamed = { ...chain, entries: chain.entries.map((x, i) => (i === 0 ? { ...x, name: "다른 사람" } : x)) };
    expect((await verifyChain(me.key, renamed))[0].text).toContain("서명이 맞지 않습니다");
    const cut = { ...chain, entries: [chain.entries[0], { ...chain.entries[2], seq: 1 }] };
    expect((await verifyChain(me.key, cut))[0].seq).toBe(1);
    // 남의 열쇠로 내 원장인 척하기
    const forged = (await sign({}, other, SUB, [], [e], "2026-11-20T01:00:00.000Z"))[other.key];
    expect((await verifyChain(me.key, { pub: me.pub, entries: forged.entries.map((x) => ({ ...x, key: me.key })) }))[0].text).toContain("서명이 맞지 않습니다");
    expect((await verifyChain(me.key, forged))[0].text).toContain("공개 열쇠가 열쇠 id와 맞지 않습니다");
  });

  it("기기마다 원장이 따로 있어 동시에 써도 합쳐지고, 누가 줄을 잘라 내도 다른 기기의 사본이 지킨다", async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    const e1 = draft();
    const e2 = draft({ id: "e2", item: "생수" });
    const onA = await sign({}, a, SUB, [], [e1], "2026-11-20T01:00:00.000Z");
    const onB = await sign({}, b, SUB, [], [e2], "2026-11-20T01:00:00.000Z"); // 같은 시각에 다른 기기에서
    const merged = await mergeLedgers(onA, onB.valueOf() as Ledger);
    expect(merged.problems).toEqual([]);
    expect(Object.keys(merged.ledger).sort()).toEqual([a.key, b.key].sort());

    // A가 한 줄을 더 쓴 뒤, 서버 사본에서 누군가 A의 원장을 예전 길이로 되돌린다
    const longer = await sign(merged.ledger, a, SUB, [e1], [{ ...e1, amount: 12000 }], "2026-11-20T02:00:00.000Z");
    const rolledBack: Ledger = { ...longer, [a.key]: { ...longer[a.key], entries: longer[a.key].entries.slice(0, 1) } };
    const kept = await mergeLedgers(longer, rolledBack);
    expect(kept.problems).toEqual([]);
    expect(kept.ledger[a.key].entries).toHaveLength(2); // 긴 사본이 남는다
    expect((await mergeLedgers(rolledBack, longer)).ledger[a.key].entries).toHaveLength(2); // 뒤처진 기기는 따라잡는다

    // 같은 순번에 다른 줄을 쓴 원장(갈라진 원장)은 받지 않는다
    const fork = await sign(merged.ledger, a, SUB, [e1], [{ ...e1, amount: 99000 }], "2026-11-20T02:00:00.000Z");
    const split = await mergeLedgers(longer, fork);
    expect(split.problems[0].text).toContain("이 기기의 사본과 다릅니다");
    expect(split.ledger[a.key]).toBe(longer[a.key]);
    // 검증에 실패한 원장은 받지 않는다
    const broken: Ledger = { [b.key]: { ...onB[b.key], entries: onB[b.key].entries.map((x) => ({ ...x, digest: "f".repeat(64) })) } };
    const refused = await mergeLedgers(onA, broken);
    expect(refused.problems).toHaveLength(1);
    expect(refused.ledger[b.key]).toBeUndefined();
  });

  it("승인은 승인자 역할의 다른 기기가 서명해야 인정한다", async () => {
    const sub = await createIdentity();
    const app = await createIdentity();
    const e = draft();
    const base = await sign({}, sub, SUB, [], [e], "2026-11-20T01:00:00.000Z");
    expect(await auditRecord(e, base)).toMatchObject({ signed: true, signer: { key: sub.key, name: "김다온" } });
    expect((await auditRecord(e, base)).approval).toBeUndefined();

    const approved = approveExpense(e, "박승인", "2026-11-21T00:00:00.000Z");
    const good = await sign(base, app, APP, [e], [approved], "2026-11-21T00:00:00.000Z");
    expect(good[app.key].entries[0].type).toBe("approve");
    expect((await auditRecord(approved, good)).approval).toMatchObject({ ok: true, by: { key: app.key, name: "박승인" }, submitter: { key: sub.key, name: "김다온" } });

    // 올린 기기가 스스로 승인
    const self = await sign(base, sub, { name: "김다온", role: "approver" }, [e], [approved], "2026-11-21T00:00:00.000Z");
    expect((await auditRecord(approved, self)).approval).toMatchObject({ ok: false, text: "올린 기기와 승인한 기기가 같습니다" });
    // 승인자 역할이 아닌 기기가 승인
    const wrongRole = await sign(base, app, { name: "이등록", role: "submitter" }, [e], [approved], "2026-11-21T00:00:00.000Z");
    expect((await auditRecord(approved, wrongRole)).approval).toMatchObject({ ok: false, text: "승인자 역할이 아닌 기기가 승인했습니다" });
    // 서명 없이 승인 표시만 붙인 기록
    expect(await auditRecord(approved, base)).toMatchObject({ signed: false, approval: { ok: false, text: "승인 서명이 없습니다" } });
    // 승인 뒤에 금액을 몰래 바꾼 기록
    expect(await auditRecord({ ...approved, amount: 90000 }, good)).toMatchObject({ signed: false, approval: { ok: false } });
  });

  it("단체가 '등록자도 승인'으로 정했으면 등록자 기기의 승인과 직접 올린 지출의 승인을 받아들이고, 그렇다고 적는다", async () => {
    const sub = await createIdentity();
    const other = await createIdentity();
    const e = draft();
    const base = await sign({}, sub, SUB, [], [e], "2026-11-20T01:00:00.000Z");
    const approved = approveExpense(e, "이등록", "2026-11-21T00:00:00.000Z");
    const open = { submitterApproves: true };
    // 다른 등록자 기기가 승인
    const byMember = await sign(base, other, { name: "이등록", role: "submitter" }, [e], [approved], "2026-11-21T00:00:00.000Z");
    expect((await auditRecord(approved, byMember, open)).approval).toMatchObject({ ok: true, text: "등록자 기기가 승인했습니다", by: { key: other.key }, submitter: { key: sub.key } });
    expect((await auditRecord(approved, byMember)).approval).toMatchObject({ ok: false }); // 정하지 않은 단체에서는 여전히 인정하지 않는다
    // 올린 기기가 직접 승인
    const self = await sign(base, sub, SUB, [e], [approved], "2026-11-21T00:00:00.000Z");
    expect((await auditRecord(approved, self, open)).approval).toMatchObject({ ok: true, text: "올린 기기가 직접 승인했습니다" });
    // 승인자 기기의 승인은 예전과 같은 문구다
    const byApprover = await sign(base, other, APP, [e], [approved], "2026-11-21T00:00:00.000Z");
    expect((await auditRecord(approved, byApprover, open)).approval).toMatchObject({ ok: true, text: "승인 서명을 확인했습니다" });
    // 승인 뒤에 금액을 바꾼 기록과 서명 없는 승인은 이 방식에서도 걸린다
    expect((await auditRecord({ ...approved, amount: 90000 }, self, open)).approval).toMatchObject({ ok: false });
    expect((await auditRecord(approved, base, open)).approval).toMatchObject({ ok: false, text: "승인 서명이 없습니다" });
  });

  it("지문: 원장에 줄이 늘면 원장 지문이 바뀌고, 보고서 지문은 기록 내용이 바뀔 때만 바뀐다", async () => {
    const me = await createIdentity();
    const e1 = draft();
    const e2 = draft({ id: "e2", item: "생수" });
    const one = await sign({}, me, SUB, [], [e1, e2], "2026-11-20T01:00:00.000Z");
    const two = await sign(one, me, SUB, [e1, e2], [{ ...e1, amount: 1 }, e2], "2026-11-20T02:00:00.000Z");
    expect(await ledgerHead(one)).not.toBe(await ledgerHead(two));
    expect(await ledgerHead(one)).toBe(await ledgerHead(JSON.parse(JSON.stringify(one))));
    expect(await recordsFingerprint([e1, e2])).toBe(await recordsFingerprint([e2, { ...e1, updatedAt: "x" }]));
    expect(await recordsFingerprint([e1, e2])).not.toBe(await recordsFingerprint([{ ...e1, amount: 1 }, e2]));
    expect(shortPrint(await ledgerHead(one))).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(members(two)).toMatchObject([{ key: me.key, name: "김다온", role: "submitter", entries: 3 }]);
  });
});
