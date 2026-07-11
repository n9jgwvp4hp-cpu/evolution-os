import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl, isGoogleConfigured } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/google/auth[?brandId=…] — start the OAuth consent flow. When a brandId
 * is supplied it is carried through `state` so the callback stores the resulting
 * tokens under that brand's connection (Gmail + Calendar in one grant).
 */
export async function GET(req: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: "Google isn't configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local." },
      { status: 400 }
    );
  }
  const brandId = req.nextUrl.searchParams.get("brandId");
  const state = brandId ? Buffer.from(JSON.stringify({ brandId })).toString("base64url") : undefined;
  return NextResponse.redirect(buildAuthUrl(state));
}
