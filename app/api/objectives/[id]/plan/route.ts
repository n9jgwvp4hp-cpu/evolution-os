import { NextRequest, NextResponse } from "next/server";
import { planObjective } from "@/lib/server/objectivePlanner";
import { startWorker } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/objectives/[id]/plan — run the Objective Planner on demand.
 * This is what makes "Grow Prism44" real: the OS reasons about the objective and
 * creates / pauses / reprioritizes the missions that move it forward. `force`
 * bypasses the re-review interval (on-demand always forces by default).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  startWorker(); // ensure the worker is live so newly created missions execute
  const body = await req.json().catch(() => ({}));
  const force = body.force !== false;
  const plan = await planObjective(params.id, { force });
  return NextResponse.json({ ok: plan.ok, plan }, { status: plan.ok ? 200 : 200 });
}
