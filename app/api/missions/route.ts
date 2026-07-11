import { NextRequest, NextResponse } from "next/server";
import { listMissionViews } from "@/lib/server/missionStore";
import { createMission, startWorker } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — all missions with progress + results (the heavy api history is omitted). */
export async function GET() {
  startWorker(); // idempotent — boots the background worker on first request after a (re)start
  const missions = await listMissionViews();
  return NextResponse.json({ missions });
}

/** POST — accept an objective and enqueue it; the worker executes it server-side. */
export async function POST(req: NextRequest) {
  startWorker();
  const body = await req.json().catch(() => ({}));
  const objective = body.objective;
  if (!objective || !String(objective).trim()) {
    return NextResponse.json({ error: "Objective required." }, { status: 400 });
  }
  const delayMinutes = Number(body.delayMinutes) || 0;
  const everyMinutes = Number(body.everyMinutes) || 0;
  const m = await createMission(String(objective).trim(), {
    scheduledFor: delayMinutes > 0 ? Date.now() + delayMinutes * 60_000 : undefined,
    recurrence: everyMinutes > 0 ? { everyMs: everyMinutes * 60_000 } : undefined,
    objectiveId: body.objectiveId ? String(body.objectiveId) : null, // traceability up the hierarchy
    brandId: body.brandId ? String(body.brandId) : null, // missions belong to a specific brand
  });
  return NextResponse.json({ id: m.id, status: m.status, scheduledFor: m.scheduledFor ?? null });
}
