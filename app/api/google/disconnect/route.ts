import { NextRequest, NextResponse } from "next/server";
import { clearTokens } from "@/lib/google";
import { saveGoogleTokens } from "@/lib/server/google";
import { clearBrandTokens } from "@/lib/server/brandGoogle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/google/disconnect[?brandId=…] — disconnect a brand's Google account.
 * Without a brandId it clears the legacy/primary connection (back-compat).
 */
export async function POST(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  if (brandId) {
    await clearBrandTokens(brandId);
    return NextResponse.json({ ok: true, brandId });
  }
  clearTokens();
  await saveGoogleTokens(null as any); // also revoke the worker's access
  return NextResponse.json({ ok: true });
}
