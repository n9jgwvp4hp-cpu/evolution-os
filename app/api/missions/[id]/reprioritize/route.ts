import { NextRequest, NextResponse } from "next/server";
import { reprioritizeMission } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/missions/[id]/reprioritize — set claim priority (higher = sooner). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const ok = await reprioritizeMission(params.id, Number(body.priority) || 0, body.reason);
  return NextResponse.json({ ok });
}
