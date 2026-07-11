import { NextRequest, NextResponse } from "next/server";
import { getMission, deleteMission } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET a single mission (full detail). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const m = await getMission(params.id);
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { api, ...view } = m as any;
  return NextResponse.json({ ok: true, mission: view });
}

/** DELETE a mission entirely (hard delete). ?cascadeTree=1 removes its whole
 *  dependency subtree too. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const cascadeTree = req.nextUrl.searchParams.get("cascadeTree") === "1";
  const removed = await deleteMission(params.id, { cascadeTree });
  return NextResponse.json({ ok: true, removed });
}
