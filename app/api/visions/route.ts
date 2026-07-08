import { NextRequest, NextResponse } from "next/server";
import { read, mutate, uid } from "@/lib/server/db";
import type { Vision } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET all visions / POST a new vision (a long-term future being built). */
export async function GET() {
  return NextResponse.json({ ok: true, visions: await read((db) => db.visions || []) });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.title) return NextResponse.json({ error: "title required." }, { status: 400 });
  const v: Vision = {
    id: uid(),
    title: String(b.title).slice(0, 160),
    description: String(b.description || "").slice(0, 3000),
    horizon: b.horizon ? String(b.horizon).slice(0, 60) : undefined,
    status: ["active", "paused", "archived"].includes(b.status) ? b.status : "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await mutate((db) => { db.visions = [v, ...(db.visions || [])]; });
  return NextResponse.json({ ok: true, vision: v });
}
