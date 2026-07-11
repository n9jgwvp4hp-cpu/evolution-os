import { NextRequest, NextResponse } from "next/server";
import { submitForm } from "@/lib/server/brands";
import { runLeadIntake } from "@/lib/server/leadIntake";
import { startWorker } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/[id]/submit — submit an onboarding form. Creates a
 * brand-scoped CRM lead with lead-source + campaign attribution, then runs lead
 * intake (auto-generates the brand's mission template for the new lead).
 * Body: { data: { [fieldId]: value }, leadSource?, campaign? }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  startWorker(); // ensure auto-generated missions execute
  const body = await req.json().catch(() => ({}));
  const r = await submitForm(params.id, body.data || {}, body.leadSource, body.campaign);
  if (!r.ok) return NextResponse.json(r, { status: 400 });
  // Instagram/Website/Ads → onboarding → CRM → automatic mission generation.
  const intake = await runLeadIntake(r.contactId!);
  return NextResponse.json({ ...r, missionsCreated: intake.missionIds.length, missionIds: intake.missionIds });
}
