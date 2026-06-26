import { NextRequest, NextResponse } from "next/server";
import { listMissions } from "@/lib/server/db";
import { createMission, startWorker } from "@/lib/server/missionEngine";
import type { MissionView } from "@/lib/missionTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — all missions with progress + results (the heavy api history is omitted). */
export async function GET() {
  startWorker(); // idempotent — boots the background worker on first request after a (re)start
  const missions = await listMissions();
  const views: MissionView[] = missions.map(({ api, ...rest }) => rest);
  return NextResponse.json({ missions: views });
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
  });
  return NextResponse.json({ id: m.id, status: m.status, scheduledFor: m.scheduledFor ?? null });
}
