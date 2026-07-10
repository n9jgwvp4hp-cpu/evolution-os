import { NextRequest, NextResponse } from "next/server";
import { getSettings, setActiveBrand } from "@/lib/server/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET/PUT the active brand (drives the switcher + scoped views). */
export async function GET() {
  const s = await getSettings();
  return NextResponse.json({ ok: true, activeBrandId: s.activeBrandId });
}

export async function PUT(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const s = await setActiveBrand(b.brandId ?? null);
  return NextResponse.json({ ok: true, activeBrandId: s.activeBrandId });
}
