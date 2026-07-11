import { NextRequest, NextResponse } from "next/server";
import { mutate, uid } from "@/lib/server/db";
import { listObjectives, ensureObjectivesSeeded } from "@/lib/server/data";
import { listMissionViews } from "@/lib/server/missionStore";
import { startWorker } from "@/lib/server/missionEngine";
import { planObjective } from "@/lib/server/objectivePlanner";
import type { Objective } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET all objectives (seeds the example starters on first call) with a live
 * rollup of the missions each one generated. POST a new objective and immediately
 * generate its missions (the autonomous engine plans it on creation).
 */
export async function GET() {
  startWorker();
  await ensureObjectivesSeeded();
  const [objectives, missions] = await Promise.all([listObjectives(), listMissionViews()]);
  const withMissions = objectives.map((o) => {
    const ms = missions.filter((m) => m.objectiveId === o.id);
    return {
      ...o,
      missions: {
        total: ms.length,
        inProgress: ms.filter((m) => m.status === "running").length,
        queued: ms.filter((m) => m.status === "queued").length,
        blocked: ms.filter((m) => m.status === "failed" || m.status === "paused").length,
        waitingApproval: ms.filter((m) => m.status === "needs_approval").length,
        done: ms.filter((m) => m.status === "done").length,
      },
    };
  });
  return NextResponse.json({ ok: true, objectives: withMissions });
}

export async function POST(req: NextRequest) {
  startWorker();
  const b = await req.json().catch(() => null);
  if (!b?.title) return NextResponse.json({ error: "title required." }, { status: 400 });
  const o: Objective = {
    id: uid(),
    brandId: b.brandId ? String(b.brandId) : null,
    visionId: b.visionId ? String(b.visionId) : null,
    title: String(b.title).slice(0, 200),
    description: String(b.description || "").slice(0, 3000),
    metric: b.metric ? String(b.metric).slice(0, 200) : undefined,
    target: b.target ? String(b.target).slice(0, 120) : undefined,
    current: b.current ? String(b.current).slice(0, 120) : undefined,
    status: ["active", "paused", "done"].includes(b.status) ? b.status : "active",
    priority: Number.isFinite(b.priority) ? Math.max(1, Math.min(5, Math.round(b.priority))) : 3,
    state: b.state ? String(b.state).slice(0, 200) : "new",
    progress: Number.isFinite(b.progress) ? Math.max(0, Math.min(100, b.progress)) : 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastReviewedAt: null,
  };
  await mutate((db) => { db.objectives = [o, ...(db.objectives || [])]; });
  // Autonomously generate this objective's missions right away (best-effort).
  let planned = null;
  if (b.plan !== false) {
    try { planned = await planObjective(o.id, { force: true }); } catch { /* planning is best-effort */ }
  }
  return NextResponse.json({ ok: true, objective: o, planned });
}
