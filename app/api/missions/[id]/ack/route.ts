import { NextRequest, NextResponse } from "next/server";
import { setMissionAcknowledged } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/missions/[id]/ack — mark a completed mission as seen.
 * Non-destructive: the mission + its result stay in the durable record; this
 * only clears it from "results waiting" — consistently across every device.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const acknowledged = body.acknowledged !== false;
  await setMissionAcknowledged(params.id, acknowledged);
  return NextResponse.json({ ok: true });
}
