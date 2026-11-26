// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultStore, delImage, getImage, imageKind, purgeRecordImages, putImage } from "@/lib/sync-store";

// 단체 공간의 영수증 이미지 (기기에서 암호화한 것). ?kind=orig 원본, ?kind=view 후원자용.
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; eid: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id, eid } = await params;
  return getImage(defaultStore(), id, eid, imageKind(new URL(req.url).searchParams.get("kind")));
}
export async function PUT(req: Request, { params }: Ctx) {
  const { id, eid } = await params;
  const body = await req.json().catch(() => null);
  return putImage(defaultStore(), id, eid, req.headers.get("x-write-token"), body, imageKind(new URL(req.url).searchParams.get("kind")));
}
// ?kind=all이면 그 기록에 딸린 사진을 종류와 관계없이 모두 지운다 (기록을 지웠을 때).
export async function DELETE(req: Request, { params }: Ctx) {
  const { id, eid } = await params;
  if (new URL(req.url).searchParams.get("kind") === "all") return purgeRecordImages(defaultStore(), id, eid, req.headers.get("x-write-token"));
  return delImage(defaultStore(), id, eid, req.headers.get("x-write-token"), imageKind(new URL(req.url).searchParams.get("kind")));
}
