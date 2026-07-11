import { NextRequest, NextResponse } from "next/server";
import { resolveBrandEmail, resolveBrandCalendar } from "@/lib/server/brandIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/brands/[id]/identity — the resolved email + calendar identity Evolution
 * OS uses for this brand (auto-selected). Shows whether the brand has its own
 * connected Gmail/calendar or is falling back to the primary account.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const [email, calendar] = await Promise.all([
    resolveBrandEmail(params.id),
    resolveBrandCalendar(params.id),
  ]);
  return NextResponse.json({ ok: true, email, calendar });
}
