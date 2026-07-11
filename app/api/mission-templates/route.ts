import { NextRequest, NextResponse } from "next/server";
import { listTemplates, createTemplate } from "@/lib/server/missionTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET brand mission templates (?brandId=…) / POST a new template. */
export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId") || undefined;
  return NextResponse.json({ ok: true, templates: await listTemplates(brandId) });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.brandId) return NextResponse.json({ error: "brandId required." }, { status: 400 });
  return NextResponse.json({ ok: true, template: await createTemplate(b) });
}
