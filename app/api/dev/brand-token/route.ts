import { NextRequest, NextResponse } from "next/server";
import { saveBrandTokens, clearBrandTokens, getBrandAccessToken } from "@/lib/server/brandGoogle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test-only helper to exercise per-brand Google token ROUTING without completing
 * a real OAuth consent. Inert in production: returns 404 unless EVO_TEST_HOOKS=1.
 * It injects a fake (non-refreshable, still-valid) token so the resolution order
 * (brand → parent → legacy) and context routing can be verified end to end.
 */
const enabled = () => process.env.EVO_TEST_HOOKS === "1";

export async function POST(req: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  if (!b?.brandId) return NextResponse.json({ error: "brandId required" }, { status: 400 });
  if (b.clear) { await clearBrandTokens(String(b.brandId)); return NextResponse.json({ ok: true, cleared: b.brandId }); }
  await saveBrandTokens(String(b.brandId), {
    access_token: `test-token-${b.brandId}`,
    refresh_token: `test-refresh-${b.brandId}`,
    expiry: Date.now() + 3_600_000,
    email: b.email || `brand-${b.brandId}@example.com`,
  });
  return NextResponse.json({ ok: true, brandId: b.brandId });
}

/** GET ?resolve=brandId → the access token a brand resolves to (proves routing). */
export async function GET(req: NextRequest) {
  if (!enabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const brandId = req.nextUrl.searchParams.get("resolve");
  if (!brandId) return NextResponse.json({ error: "resolve=brandId required" }, { status: 400 });
  try {
    const token = await getBrandAccessToken(brandId);
    return NextResponse.json({ ok: true, brandId, token });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) });
  }
}
