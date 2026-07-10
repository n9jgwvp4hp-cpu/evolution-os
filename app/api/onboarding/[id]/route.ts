import { NextRequest, NextResponse } from "next/server";
import { getForm, patchForm, deleteForm } from "@/lib/server/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const form = await getForm(params.id);
  return form ? NextResponse.json({ ok: true, form }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const form = await patchForm(params.id, b);
  return form ? NextResponse.json({ ok: true, form }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: await deleteForm(params.id) });
}
