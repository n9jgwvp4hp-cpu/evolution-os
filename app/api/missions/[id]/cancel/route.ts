import { NextRequest, NextResponse } from "next/server";
import { cancelMission } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/missions/[id]/cancel — stop a mission and clear any recurrence. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  await cancelMission(params.id);
  return NextResponse.json({ ok: true });
}
