import { NextRequest, NextResponse } from "next/server";
import { read, mutate } from "@/lib/server/db";
import type { Identity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET/PUT the user's Identity (who they are + what they value) — a singleton. */
export async function GET() {
  return NextResponse.json({ ok: true, identity: await read((db) => db.identity ?? null) });
}

export async function PUT(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const arr = (x: any) => (Array.isArray(x) ? x.map((s) => String(s).slice(0, 200)).slice(0, 30) : undefined);
  const identity: Identity = {
    name: b.name ? String(b.name).slice(0, 120) : undefined,
    roles: arr(b.roles),
    values: arr(b.values),
    principles: arr(b.principles),
    bio: b.bio ? String(b.bio).slice(0, 4000) : undefined,
    updatedAt: Date.now(),
  };
  await mutate((db) => { db.identity = identity; });
  return NextResponse.json({ ok: true, identity });
}
