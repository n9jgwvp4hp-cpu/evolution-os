import { NextResponse } from "next/server";
import { read, getWorkerHeartbeat, dbBackend } from "@/lib/server/db";
import { listMissionViews } from "@/lib/server/missionStore";
import { startWorker } from "@/lib/server/missionEngine";
import { fetchWithTimeout } from "@/lib/server/http";
import type { MissionView } from "@/lib/missionTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ops — one live snapshot of everything Evolution OS is doing, for the
 * Operations Command Center. Aggregates missions (active / scheduled / history /
 * errors), the kernel, the Priority Queue, recent decisions, drafts + calendar
 * actions awaiting approval, and per-subsystem health.
 */

type StepLite = { ts: number; kind: string; text: string; detail?: string };

/** Enrich a mission with execution timing derived from its status log. */
function enrich(m: MissionView, now: number) {
  const steps = (m.steps || []) as StepLite[];
  const st = (label: string) => steps.find((s) => s.kind === "status" && s.text.startsWith(label));
  const startedAt = st("Running")?.ts;
  const term = [...steps].reverse().find((s) => s.kind === "status" && (s.text === "Completed" || s.text === "Failed"));
  const endedAt = term?.ts;
  const durationMs = startedAt ? (endedAt || now) - startedAt : ["done", "failed"].includes(m.status) ? m.updatedAt - m.createdAt : null;
  const lastError = [...steps].reverse().find((s) => s.kind === "error")?.text;
  const last = steps[steps.length - 1];
  const actionCount = steps.filter((s) => s.kind === "action").length;
  return {
    id: m.id, objective: m.objective, objectiveId: m.objectiveId ?? null, priority: m.priority ?? 0, status: m.status,
    createdAt: m.createdAt, updatedAt: m.updatedAt, startedAt, endedAt, durationMs,
    attempts: m.attempts || 0, stepCount: steps.length, actionCount,
    currentStep: last ? last.text : null, // what the mission is doing right now
    scheduledFor: m.scheduledFor, recurrence: m.recurrence, lastError,
    isKernel: m.objective.startsWith("[KERNEL]"),
  };
}

async function gmailDrafts(): Promise<{ ok: boolean; drafts: any[] }> {
  try {
    const { getServerAccessToken } = await import("@/lib/server/google");
    const token = await getServerAccessToken();
    const auth = { Authorization: `Bearer ${token}` };
    const list = await fetchWithTimeout("https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=10", { headers: auth }, 8000);
    if (!list.ok) return { ok: false, drafts: [] };
    const refs = (await list.json()).drafts || [];
    const drafts: any[] = [];
    for (const r of refs.slice(0, 6)) {
      const g = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${r.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, { headers: auth }, 6000);
      if (!g.ok) continue;
      const hdr: Record<string, string> = {};
      for (const h of (await g.json()).message?.payload?.headers || []) hdr[h.name.toLowerCase()] = h.value;
      drafts.push({ id: r.id, to: hdr.to || "", subject: hdr.subject || "(no subject)", date: hdr.date || "" });
    }
    return { ok: true, drafts };
  } catch {
    return { ok: false, drafts: [] };
  }
}

export async function GET() {
  startWorker();
  const now = Date.now();
  const [missions, beat, brain] = await Promise.all([
    listMissionViews(),
    getWorkerHeartbeat(),
    read((db) => ({
      priorities: db.priorities || [],
      tasks: db.tasks || [],
      contacts: db.contacts || [],
      deals: db.deals || [],
      orchestrator: db.orchestrator || null,
      automationRules: db.automationRules || [],
      eventLog: db.eventLog || [],
      googleConnected: !!db.google,
      identity: db.identity || null,
      visions: db.visions || [],
      objectives: db.objectives || [],
    })),
  ]);

  // subsystem health
  const workerAlive = beat != null && now - beat < 45_000;
  const gmail = brain.googleConnected ? await gmailDrafts() : { ok: false, drafts: [] };
  const googleStatus = brain.googleConnected ? (gmail.ok ? "ok" : "degraded") : "down";
  const googleDetail = brain.googleConnected ? (gmail.ok ? "connected" : "token needs reconnect") : "not connected";
  const aiOk = !!process.env.OPENAI_API_KEY;

  // missions
  const all = missions.map((m) => enrich(m, now));
  const counts: Record<string, number> = {};
  for (const m of missions) counts[m.status] = (counts[m.status] || 0) + 1;
  const active = all.filter((m) => ["running", "needs_approval"].includes(m.status));
  const queuedNow = all.filter((m) => m.status === "queued" && (!m.scheduledFor || m.scheduledFor <= now));
  const scheduled = all.filter((m) => m.status === "queued" && m.scheduledFor && m.scheduledFor > now).sort((a, b) => (a.scheduledFor! - b.scheduledFor!));
  const history = all.filter((m) => ["done", "failed"].includes(m.status)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
  const errorsRetries = all.filter((m) => m.status === "failed" || m.attempts > 0).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 25);

  // kernel
  const km = missions.filter((m) => m.objective.startsWith("[KERNEL]"));
  const kNext = km.filter((m) => m.status === "queued").sort((a, b) => (a.scheduledFor || 0) - (b.scheduledFor || 0))[0];
  const kLast = km.filter((m) => m.status === "done").sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const kRunning = km.find((m) => m.status === "running");
  const kernel = {
    enabled: process.env.KERNEL_ENABLED === "true",
    everyMin: Math.round((kNext?.recurrence?.everyMs || kLast?.recurrence?.everyMs || 0) / 60000),
    nextRunAt: kNext?.scheduledFor ?? null,
    lastRunAt: kLast?.updatedAt ?? null,
    status: kRunning ? "running" : kNext ? "scheduled" : kernelDisabledOrIdle(),
  };
  function kernelDisabledOrIdle() { return process.env.KERNEL_ENABLED === "true" ? "idle" : "disabled"; }

  // recent decisions feed (across all missions)
  const recentDecisions = missions
    .flatMap((m) => ((m.steps || []) as StepLite[])
      .filter((s) => ["action", "result", "status", "progress"].includes(s.kind))
      .map((s) => ({ ts: s.ts, missionId: m.id, kind: s.kind, text: s.text })))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 25);

  // Hierarchy — Identity → Vision → Objectives → Missions. Every objective carries
  // its parent vision and the live missions laddering up to it, so the OS can trace
  // any unit of work back to the outcome (and vision) it serves.
  const visionById = new Map<string, any>(brain.visions.map((v: any) => [v.id, v]));
  const missionsByObjective = new Map<string, any[]>();
  for (const m of all) {
    if (!m.objectiveId) continue;
    (missionsByObjective.get(m.objectiveId) || missionsByObjective.set(m.objectiveId, []).get(m.objectiveId)!).push(m);
  }
  const OPEN_STATUSES = ["queued", "running", "needs_approval", "paused"];
  const objectives = brain.objectives.map((o: any) => {
    const ms = missionsByObjective.get(o.id) || [];
    const vision = o.visionId ? visionById.get(o.visionId) || null : null;
    // The single highest-value next mission = the highest-priority OPEN mission
    // (what the Objective Planner has decided the OS should do next for this objective).
    const openMs = ms.filter((m) => OPEN_STATUSES.includes(m.status)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const hv = openMs[0] || null;
    return {
      ...o,
      vision: vision ? { id: vision.id, title: vision.title, status: vision.status } : null,
      missionCounts: {
        total: ms.length,
        active: ms.filter((m) => ["running", "needs_approval"].includes(m.status)).length,
        queued: ms.filter((m) => m.status === "queued").length,
        paused: ms.filter((m) => m.status === "paused").length,
        done: ms.filter((m) => m.status === "done").length,
        failed: ms.filter((m) => m.status === "failed").length,
      },
      highestValueMission: hv ? { id: hv.id, objective: hv.objective, status: hv.status, priority: hv.priority ?? 0 } : null,
      missionIds: ms.map((m) => m.id),
    };
  });
  const unlinkedMissions = all.filter((m) => !m.objectiveId && !m.isKernel).length;
  const hierarchy = {
    identity: brain.identity,
    visions: brain.visions,
    objectives,
    counts: {
      visions: brain.visions.length,
      objectives: brain.objectives.length,
      activeObjectives: brain.objectives.filter((o: any) => o.status === "active").length,
      unlinkedMissions,
    },
  };

  const calendarActions = brain.tasks.filter((t: any) => !t.done && String(t.title).startsWith("📅")).map((t: any) => ({ title: t.title, createdAt: t.createdAt }));
  const awaitingApproval = active.filter((m) => m.status === "needs_approval");

  return NextResponse.json({
    ok: true,
    time: now,
    health: {
      database: { status: "ok", detail: dbBackend() },
      worker: { status: workerAlive ? "ok" : "down", detail: workerAlive ? `beating ${Math.round((now - beat!) / 1000)}s ago` : "no heartbeat", lastBeatMsAgo: beat ? now - beat : null },
      scheduler: { status: workerAlive ? "ok" : "down", detail: kernel.enabled ? `kernel every ${kernel.everyMin}m · ${scheduled.length} scheduled` : `${scheduled.length} scheduled` },
      gmail: { status: googleStatus, detail: googleDetail },
      calendar: { status: googleStatus, detail: googleDetail },
      crm: { status: "ok", detail: `${brain.contacts.length} contacts · ${brain.deals.length} deals` },
      ai: { status: aiOk ? "ok" : "down", detail: aiOk ? "OpenAI configured" : "no API key" },
    },
    hierarchy,
    kernel,
    orchestrator: brain.orchestrator,
    automations: {
      total: brain.automationRules.length,
      enabled: brain.automationRules.filter((r: any) => r.enabled).length,
      recentTriggers: brain.eventLog.slice(0, 12),
    },
    counts,
    missions: { active, queuedNow, scheduled, history, errorsRetries },
    priorities: brain.priorities,
    recentDecisions,
    draftsAwaitingApproval: gmail.drafts,
    calendarActions,
    awaitingApproval,
  });
}
