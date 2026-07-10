import { NextRequest, NextResponse } from "next/server";
import { resumeMission, startWorker } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/missions/[id]/resume — return a paused mission to the queue. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  startWorker();
  const body = await req.json().catch(() => ({}));
  const ok = await resumeMission(params.id, body.scheduledFor ? Number(body.scheduledFor) : undefined);
  return NextResponse.json({ ok });
}
