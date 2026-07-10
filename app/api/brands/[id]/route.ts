import { NextRequest, NextResponse } from "next/server";
import { getBrand, patchBrand, deleteBrand } from "@/lib/server/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const brand = await getBrand(params.id);
  return brand ? NextResponse.json({ ok: true, brand }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const brand = await patchBrand(params.id, b);
  return brand ? NextResponse.json({ ok: true, brand }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const r = await deleteBrand(params.id);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
