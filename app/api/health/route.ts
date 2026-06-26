import { NextResponse } from "next/server";
import { read, getWorkerHeartbeat, dbBackend } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness of the always-on runtime.
 * Confirms the brain backend, mission counts, and whether the mission worker
 * (which may run as a separate component) is beating.
 */
export async function GET() {
  const beat = await getWorkerHeartbeat();
  const ageMs = beat ? Date.now() - beat : null;
  const counts = await read((db) => {
    const c: Record<string, number> = {};
    for (const m of db.missions) c[m.status] = (c[m.status] || 0) + 1;
    return c;
  });
  return NextResponse.json({
    ok: true,
    store: dbBackend(),
    worker: {
      // Healthy if it beat within the last ~45s (tick is 2s, beat every 15s).
      alive: ageMs !== null && ageMs < 45_000,
      lastBeatMsAgo: ageMs,
    },
    missions: counts,
    time: Date.now(),
  });
}
