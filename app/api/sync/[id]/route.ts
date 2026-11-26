// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultStore, getDoc, putDoc } from "@/lib/sync-store";

// 단체 공간 문서. 서버는 암호문만 보관한다.
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

// ?since=N: 기기가 마지막으로 본 버전. 그 뒤로 바뀐 것이 없으면 내용 없이 "그대로"라고만 답한다.
export async function GET(req: Request, { params }: Ctx) {
  return getDoc(defaultStore(), (await params).id, Number(new URL(req.url).searchParams.get("since")) || 0);
}
export async function PUT(req: Request, { params }: Ctx) {
  const body = await req.json().catch(() => null);
  return putDoc(defaultStore(), (await params).id, req.headers.get("x-write-token"), body);
}
