import { NextRequest, NextResponse } from "next/server";
import { createMissionTree, startWorker } from "@/lib/server/missionEngine";
import type { MissionSeed } from "@/lib/missionTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mission-trees — plant a dependency tree. The root mission is created
 * now; each deeper node materializes automatically only when its parent completes.
 * Body: { brandId?, objectiveId?, tree } where tree is a nested MissionSeed, OR
 * { chain: [".."] } for a linear chain (auto-nested).
 */
function chainToTree(chain: string[]): MissionSeed | null {
  const items = (chain || []).map((s) => String(s).trim()).filter(Boolean);
  if (!items.length) return null;
  let node: MissionSeed | undefined;
  for (let i = items.length - 1; i >= 0; i--) node = { objective: items[i], children: node ? [node] : [] };
  return node!;
}

export async function POST(req: NextRequest) {
  startWorker();
  const b = await req.json().catch(() => ({}));
  const tree: MissionSeed | null = b.tree?.objective ? b.tree : chainToTree(b.chain);
  if (!tree) return NextResponse.json({ error: "provide `tree` (MissionSeed) or `chain` (string[])." }, { status: 400 });
  const root = await createMissionTree(tree, { brandId: b.brandId ?? null, objectiveId: b.objectiveId ?? null });
  return NextResponse.json({ ok: true, rootId: root.id, treeRootId: root.treeRootId });
}
