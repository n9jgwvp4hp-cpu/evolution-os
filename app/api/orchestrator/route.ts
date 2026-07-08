import { NextRequest, NextResponse } from "next/server";
import { read, mutate } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status channel for the Continuous Workflow Orchestrator.
 * The local orchestrator loop POSTs its live status here so the deployed
 * Operations Command Center can display it. Read-only otherwise.
 */
export async function GET() {
  const orchestrator = await read((db) => db.orchestrator ?? null);
  return NextResponse.json({ ok: true, orchestrator });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required." }, { status: 400 });
  }
  const recent = Array.isArray(body.recent) ? body.recent.slice(-40) : [];
  const status = {
    running: Boolean(body.running),
    mode: String(body.mode || "manual"),
    phase: String(body.phase || "idle"),
    currentMilestone: body.currentMilestone ?? null,
    attempt: Number(body.attempt) || 0,
    maxRetries: Number(body.maxRetries) || 0,
    message: String(body.message || "").slice(0, 500),
    lastRunAt: Number(body.lastRunAt) || Date.now(),
    nextRunAt: body.nextRunAt ? Number(body.nextRunAt) : null,
    recent,
    milestones: Array.isArray(body.milestones) ? body.milestones.slice(0, 100) : [],
  };
  await mutate((db) => { db.orchestrator = status; });
  return NextResponse.json({ ok: true });
}
