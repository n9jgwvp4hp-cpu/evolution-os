import { NextRequest, NextResponse } from "next/server";
import { pauseMission } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/missions/[id]/pause — deprioritize a not-yet-started mission. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const ok = await pauseMission(params.id, body.reason);
  return NextResponse.json({ ok });
}
