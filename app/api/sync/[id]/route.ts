// SPDX-License-Identifier: GPL-3.0-or-later
import { limitSync } from "@/lib/rate-limit";
import { defaultStore, getDoc, putDoc } from "@/lib/sync-store";

// 단체 공간 문서. 서버는 암호문만 보관한다.
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

// ?since=N: 기기가 마지막으로 본 버전. 그 뒤로 바뀐 것이 없으면 내용 없이 "그대로"라고만 답한다.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  return limitSync(req, "read", () => getDoc(defaultStore(), id, Number(new URL(req.url).searchParams.get("since")) || 0));
}
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  return limitSync(req, "write", async () => putDoc(defaultStore(), id, req.headers.get("x-write-token"), await req.json().catch(() => null)));
}
