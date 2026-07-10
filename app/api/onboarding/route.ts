import { NextRequest, NextResponse } from "next/server";
import { listForms, createForm } from "@/lib/server/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET onboarding forms (optionally ?brandId=…) / POST a new form. */
export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId") || undefined;
  return NextResponse.json({ ok: true, forms: await listForms(brandId) });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.brandId) return NextResponse.json({ error: "brandId required." }, { status: 400 });
  return NextResponse.json({ ok: true, form: await createForm(b) });
}
