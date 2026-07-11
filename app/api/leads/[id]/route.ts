import { NextRequest, NextResponse } from "next/server";
import { patchContact } from "@/lib/server/data";
import { logActivity } from "@/lib/server/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/leads/[id] — update a lead's CRM pipeline fields (stage, owner,
 * nextAction, revenue, status). Logs a pipeline/revenue activity entry.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const before = b.__stageLabel; // optional label for nicer activity text
  const c = await patchContact(params.id, b);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  if ("pipelineStage" in b) {
    await logActivity({ brandId: c.brandId ?? null, kind: "pipeline_update", title: `${c.name} moved to ${before || b.pipelineStage}`, refType: "contact", refId: c.id });
  }
  if ("revenue" in b) {
    await logActivity({ brandId: c.brandId ?? null, kind: "revenue_change", title: `${c.name} revenue set to ${b.revenue}`, refType: "contact", refId: c.id });
  }
  return NextResponse.json({ ok: true, contact: c });
}
