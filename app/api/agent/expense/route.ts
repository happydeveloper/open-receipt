// SPDX-License-Identifier: GPL-3.0-or-later
import { CORS, handleExpenseRun, preflight } from "@/lib/agui-server";
import { limitAgent } from "@/lib/rate-limit";

// AG-UI 에이전트 엔드포인트: POST RunAgentInput → text/event-stream
export const runtime = "nodejs";
export const maxDuration = 120;

export function POST(req: Request) {
  return limitAgent(req, CORS) ?? handleExpenseRun(req);
}
export function OPTIONS() {
  return preflight();
}
