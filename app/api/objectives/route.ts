import { NextRequest, NextResponse } from "next/server";
import { read, mutate, uid } from "@/lib/server/db";
import type { Objective } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET all objectives / POST a new objective (a measurable outcome that moves a vision forward). */
export async function GET() {
  return NextResponse.json({ ok: true, objectives: await read((db) => db.objectives || []) });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.title) return NextResponse.json({ error: "title required." }, { status: 400 });
  const o: Objective = {
    id: uid(),
    visionId: b.visionId ? String(b.visionId) : null,
    title: String(b.title).slice(0, 200),
    description: String(b.description || "").slice(0, 3000),
    metric: b.metric ? String(b.metric).slice(0, 200) : undefined,
    target: b.target ? String(b.target).slice(0, 120) : undefined,
    current: b.current ? String(b.current).slice(0, 120) : undefined,
    status: ["active", "paused", "done"].includes(b.status) ? b.status : "active",
    priority: Number.isFinite(b.priority) ? Math.max(1, Math.min(5, Math.round(b.priority))) : 3,
    state: b.state ? String(b.state).slice(0, 200) : "new",
    progress: Number.isFinite(b.progress) ? Math.max(0, Math.min(100, b.progress)) : 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastReviewedAt: null,
  };
  await mutate((db) => { db.objectives = [o, ...(db.objectives || [])]; });
  return NextResponse.json({ ok: true, objective: o });
}
