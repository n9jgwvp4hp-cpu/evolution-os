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
  const { objective } = await req.json().catch(() => ({}));
  if (!objective || !String(objective).trim()) {
    return NextResponse.json({ error: "Objective required." }, { status: 400 });
  }
  const m = await createMission(String(objective).trim());
  return NextResponse.json({ id: m.id, status: m.status });
}
