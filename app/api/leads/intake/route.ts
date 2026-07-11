import { NextRequest, NextResponse } from "next/server";
import { runLeadIntake } from "@/lib/server/leadIntake";
import { startWorker } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/intake — run intake for an existing CRM lead: place it at the
 * first pipeline stage and auto-generate the brand's mission template for it.
 * Body: { contactId }. Idempotent — a lead that already has missions is untouched.
 */
export async function POST(req: NextRequest) {
  startWorker();
  const b = await req.json().catch(() => ({}));
  if (!b?.contactId) return NextResponse.json({ error: "contactId required." }, { status: 400 });
  const r = await runLeadIntake(String(b.contactId));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
