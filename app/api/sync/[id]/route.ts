// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultStore, getDoc, putDoc } from "@/lib/sync-store";

// 단체 공간 문서. 서버는 암호문만 보관한다.
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return getDoc(defaultStore(), (await params).id);
}
export async function PUT(req: Request, { params }: Ctx) {
  const body = await req.json().catch(() => null);
  return putDoc(defaultStore(), (await params).id, req.headers.get("x-write-token"), body);
}
