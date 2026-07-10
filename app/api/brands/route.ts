import { NextRequest, NextResponse } from "next/server";
import { listBrands, createBrand } from "@/lib/server/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET all brands (seeds the portfolio on first call) / POST a new brand. */
export async function GET() {
  return NextResponse.json({ ok: true, brands: await listBrands() });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.name) return NextResponse.json({ error: "name required." }, { status: 400 });
  return NextResponse.json({ ok: true, brand: await createBrand(b) });
}
