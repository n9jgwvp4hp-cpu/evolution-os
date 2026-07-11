import { NextRequest, NextResponse } from "next/server";
import { listTreeMissions } from "@/lib/server/missionStore";
import type { MissionSeed } from "@/lib/missionTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mission-trees/[rootId] — the live dependency tree: realized missions
 * (with status/progress) nested by parent→child, plus the PENDING seed nodes that
 * will materialize once their parent completes.
 */
const seedNode = (s: MissionSeed): any => ({
  objective: s.objective, pending: true, status: "not_created",
  children: (s.children || []).map(seedNode),
});

export async function GET(_req: NextRequest, { params }: { params: { rootId: string } }) {
  const all = await listTreeMissions(params.rootId);
  if (!all.length) return NextResponse.json({ error: "tree not found" }, { status: 404 });

  const build = (m: any): any => ({
    id: m.id,
    objective: m.objective,
    status: m.status,
    progress: m.progress ?? 0,
    priority: m.priority ?? 0,
    deadline: m.deadline ?? null,
    dependencies: m.dependencies ?? [],
    // realized children (already spawned) …
    children: all.filter((c) => c.parentMissionId === m.id).map(build)
      // … plus not-yet-created children (still seeds on this node).
      .concat((m.childSeeds || []).map(seedNode)),
  });

  const root = all.find((m) => m.id === params.rootId) || all.find((m) => !m.parentMissionId) || all[0];
  const counts = all.reduce((a: any, m) => ((a[m.status] = (a[m.status] || 0) + 1), a), {});
  const pendingCount = all.reduce((n, m) => n + countSeeds(m.childSeeds || []), 0);
  return NextResponse.json({
    ok: true,
    rootId: params.rootId,
    realized: all.length,
    pending: pendingCount,
    counts,
    tree: build(root),
  });
}

function countSeeds(seeds: MissionSeed[]): number {
  return (seeds || []).reduce((n, s) => n + 1 + countSeeds(s.children || []), 0);
}
