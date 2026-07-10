import { NextRequest, NextResponse } from "next/server";
import { submitForm } from "@/lib/server/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboarding/[id]/submit — submit an onboarding form. Creates a
 * brand-scoped CRM lead with lead-source attribution and records the submission.
 * Body: { data: { [fieldId]: value }, leadSource?: "website"|"instagram"|... }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const r = await submitForm(params.id, body.data || {}, body.leadSource);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
