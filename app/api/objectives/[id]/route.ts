import { NextRequest, NextResponse } from "next/server";
import { mutate } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = [
  "visionId", "title", "description", "metric", "target", "current",
  "status", "priority", "state", "progress", "lastReviewedAt",
];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  let found = false;
  await mutate((db) => {
    const o = (db.objectives || []).find((x) => x.id === params.id);
    if (!o) return;
    found = true;
    for (const k of EDITABLE) if (k in b) (o as any)[k] = b[k];
    o.updatedAt = Date.now();
  });
  return found ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await mutate((db) => {
    db.objectives = (db.objectives || []).filter((o) => o.id !== params.id);
  });
  return NextResponse.json({ ok: true });
}
