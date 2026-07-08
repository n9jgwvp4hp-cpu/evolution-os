import { NextRequest, NextResponse } from "next/server";
import { mutate } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = ["name", "enabled", "from", "subjectContains", "leadMinutes", "atTime", "everyMinutes", "objective"];

/** PATCH — enable/disable or edit a rule. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  let found = false;
  await mutate((db) => {
    const r = (db.automationRules || []).find((x) => x.id === params.id);
    if (!r) return;
    found = true;
    for (const k of EDITABLE) if (k in b) (r as any)[k] = b[k];
  });
  return found ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "not found" }, { status: 404 });
}

/** DELETE — remove a rule. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  let removed = false;
  await mutate((db) => {
    const before = (db.automationRules || []).length;
    db.automationRules = (db.automationRules || []).filter((x) => x.id !== params.id);
    removed = db.automationRules.length < before;
  });
  return NextResponse.json({ ok: removed });
}
