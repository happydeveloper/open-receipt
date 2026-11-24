// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultStore } from "@/lib/sync-store";
import { joinWaitlist, leaveWaitlist } from "@/lib/waitlist";

// 정식 출시 알림 대기자 등록과 취소
export const runtime = "nodejs";

export async function POST(req: Request) {
  return joinWaitlist(defaultStore(), await req.json().catch(() => null));
}
export async function DELETE(req: Request) {
  return leaveWaitlist(defaultStore(), await req.json().catch(() => null));
}
