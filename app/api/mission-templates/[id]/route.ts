import { NextRequest, NextResponse } from "next/server";
import { getTemplate, patchTemplate, deleteTemplate } from "@/lib/server/missionTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const t = await getTemplate(params.id);
  return t ? NextResponse.json({ ok: true, template: t }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const t = await patchTemplate(params.id, b);
  return t ? NextResponse.json({ ok: true, template: t }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: await deleteTemplate(params.id) });
}
