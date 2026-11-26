// SPDX-License-Identifier: GPL-3.0-or-later
import { clearViewImages, defaultStore, getView, putView } from "@/lib/sync-store";

// 후원자용 보기 자료. 후원자 열쇠로 암호화되어 있어 링크를 가진 사람만 열 수 있다.
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return getView(defaultStore(), (await params).id);
}
export async function PUT(req: Request, { params }: Ctx) {
  const body = await req.json().catch(() => null);
  return putView(defaultStore(), (await params).id, req.headers.get("x-write-token"), body);
}
// 후원자용으로 올려 둔 사진을 모두 지운다 (후원자용 보기를 닫을 때).
export async function DELETE(req: Request, { params }: Ctx) {
  return clearViewImages(defaultStore(), (await params).id, req.headers.get("x-write-token"));
}
