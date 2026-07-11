import { NextRequest, NextResponse } from "next/server";
import { resolveApproval } from "@/lib/server/approvals";
import { approveMission, startWorker } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/approvals/[id] — resolve an approval.
 * Body: { approved: boolean, kind?: "stored" | "mission" }.
 * Mission approvals route to the mission engine; stored approvals resolve here.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  startWorker();
  const b = await req.json().catch(() => ({}));
  const approved = b.approved !== false;
  if (b.kind === "mission") {
    await approveMission(params.id, approved);
    return NextResponse.json({ ok: true, kind: "mission", approved });
  }
  const a = await resolveApproval(params.id, approved);
  return a ? NextResponse.json({ ok: true, kind: "stored", approval: a }) : NextResponse.json({ error: "not found" }, { status: 404 });
}
