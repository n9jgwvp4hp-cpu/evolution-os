import { NextResponse } from "next/server";
import { listBrandConnections } from "@/lib/server/brandGoogle";
import { isGoogleConfigured } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/brands/connections — per-brand Google connection status for the
 * Connections page. Each brand reports whether it has its OWN Gmail/Calendar
 * connection and, if not, which account it currently operates through.
 */
export async function GET() {
  const connections = await listBrandConnections();
  return NextResponse.json({ ok: true, configured: isGoogleConfigured(), connections });
}
