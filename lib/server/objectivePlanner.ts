/**
 * Objective Planner — the reasoning core of Evolution OS (Milestone 2).
 *
 * Objectives are the primary planning unit. For each active objective the planner
 * runs a PERCEIVE → REASON → APPLY loop:
 *
 *   PERCEIVE  gather the objective's evolving state, every mission laddering up to
 *             it (any status), its slice of the Priority Queue, and memory (brain).
 *   REASON    one structured model call decides what needs to happen: which
 *             missions to CREATE, PAUSE, RESUME, COMPLETE, or REPRIORITIZE, the
 *             single HIGHEST-VALUE next mission, an updated objective `state` +
 *             `progress`, and the objective-scoped priorities.
 *   APPLY     reconcile that plan with reality — create linked missions (deduped &
 *             capped so it can never loop), pause/resume/complete/reprioritize
 *             existing ones, boost the highest-value mission, publish priorities,
 *             and persist the new objective state + lastReviewedAt.
 *
 * Safety carries over from the mission engine: planner-created missions run through
 * the same persistent, exactly-once engine and CANNOT take outward/irreversible
 * actions (send email, create events) without approval — they draft/suggest only.
 * Hard caps + dedup + a re-review interval prevent runaway mission creation.
 */
import { listMissionViews } from "@/lib/server/missionStore";
import { createMission, pauseMission, resumeMission, reprioritizeMission, cancelMission } from "@/lib/server/missionEngine";
import { getObjective, patchObjective, listActiveObjectives, replaceObjectivePriorities, buildBrainContext } from "@/lib/server/data";
import type { Objective } from "@/lib/types";
import type { MissionView } from "@/lib/missionTypes";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const model = () => process.env.OPENAI_MODEL || "gpt-4o-mini";
const key = () => process.env.OPENAI_API_KEY || "";

// --- guardrails against runaway mission creation ---
const MAX_NEW_MISSIONS_PER_CYCLE = 3; // never spawn more than this per plan run
const MAX_OPEN_MISSIONS_PER_OBJECTIVE = 6; // stop creating once this many are open (queued+running+paused+approval)
const DEDUP_JACCARD = 0.6; // token overlap above which a "new" mission is treated as a duplicate
export const MIN_REVIEW_INTERVAL_MS = 20 * 60_000; // don't auto-re-review an objective more often than this

const TERMINAL = new Set(["done", "failed"]);
const OPEN = new Set(["queued", "running", "needs_approval", "paused"]);

/* ---------- text normalization / dedup ---------- */
function tokens(s: string): Set<string> {
  return new Set(
    String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2)
  );
}
function jaccard(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  Array.from(ta).forEach((t) => { if (tb.has(t)) inter++; });
  return inter / (ta.size + tb.size - inter);
}
/** The model (free-form JSON) sometimes names the mission-text field differently.
 *  Accept any of the common keys so a valid plan is never silently dropped. */
function missionText(c: any): string {
  const v = c?.objective ?? c?.mission ?? c?.title ?? c?.task ?? c?.step ?? c?.action ?? c?.description ?? "";
  return typeof v === "string" ? v.trim() : "";
}

/* ---------- the structured reasoning call ---------- */
type RawPlan = {
  stateSummary?: string;
  progress?: number;
  objectiveStatus?: string;
  reasoning?: string;
  createMissions?: Array<{ objective?: string; immediate?: boolean; why?: string; highestValue?: boolean }>;
  pauseMissionIds?: string[];
  resumeMissionIds?: string[];
  completeMissionIds?: string[];
  reprioritize?: Array<{ missionId?: string; priority?: number }>;
  priorities?: any[];
};

async function reason(objective: Objective, missions: MissionView[], memory: string): Promise<RawPlan> {
  const missionLines = missions.length
    ? missions
        .map((m) => {
          const last = (m.steps || [])[m.steps.length - 1];
          return `- id=${m.id} [${m.status}${m.priority ? ` p${m.priority}` : ""}] "${String(m.objective).slice(0, 140)}"${last ? ` — last: ${String(last.text).slice(0, 80)}` : ""}`;
        })
        .join("\n")
    : "(none yet)";

  const sys =
    "You are the Objective Planner inside Evolution OS, a personal operating system. " +
    "Objectives are the primary planning unit. Your job: continuously move THIS objective forward with the " +
    "least effort from the user, by deciding what work should exist right now.\n" +
    "You reconcile the objective with the missions already laddering up to it. Reason about: what needs to " +
    "happen next, what is already in progress, what changed, and what is now stale.\n" +
    "DECIDE and return JSON ONLY:\n" +
    "- createMissions: NEW missions to spawn (each a concrete, self-contained objective the execution engine can run " +
    "autonomously). Set immediate=true for work to start now, false to defer. Mark exactly ONE (the single " +
    "highest-value next step) highestValue=true. Do NOT recreate work that an existing OPEN mission already covers.\n" +
    "- pauseMissionIds / resumeMissionIds / completeMissionIds: existing mission ids to pause (no longer valuable), " +
    "resume (regained value), or complete (superseded/obsolete). Use ONLY ids from the list below.\n" +
    "- reprioritize: [{missionId, priority}] where higher priority = run sooner.\n" +
    "- priorities: the objective's slice of the user's Priority Queue — ranked items, each with urgency (1-5), " +
    "importance (1-5), optional deadline (ISO) + dependsOn, a concrete recommendedAction, a source, and a REQUIRED why.\n" +
    "- stateSummary: a concise (<=600 chars) evolving summary of where this objective stands (this REPLACES the " +
    "prior state and is your memory across cycles).\n" +
    "- progress: 0-100 estimate. objectiveStatus: 'active' | 'paused' | 'done' (mark done ONLY if the objective is truly achieved).\n" +
    "- reasoning: 1-3 sentences on why you decided this.\n" +
    "SAFETY: missions cannot send email or create calendar events without approval — they draft/suggest. Prefer a few " +
    "high-leverage missions over many. If nothing new is needed, return empty createMissions and just update state.";

  const user =
    `OBJECTIVE: ${objective.title}\n` +
    (objective.description ? `Description: ${objective.description}\n` : "") +
    (objective.metric ? `Metric: ${objective.metric}${objective.target ? ` (target ${objective.target}${objective.current ? `, current ${objective.current}` : ""})` : ""}\n` : "") +
    `Status: ${objective.status} · progress: ${objective.progress ?? 0}%\n` +
    `Current evolving state: ${objective.state || "(none yet — this is the first review)"}\n\n` +
    `MISSIONS laddering up to this objective:\n${missionLines}\n\n` +
    (memory ? `WHAT EVOLUTION OS ALREADY KNOWS (memory):\n${memory.slice(0, 3500)}\n\n` : "") +
    `Decide the plan now. Return JSON only.`;

  const body = {
    model: model(),
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    response_format: { type: "json_object" },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")).slice(0, 200) || `HTTP ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(content) as RawPlan;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- the public planning API ---------- */
export type PlanResult = {
  ok: boolean;
  objectiveId: string;
  reason?: string;
  created: Array<{ id: string; objective: string; immediate: boolean; highestValue: boolean; priority: number }>;
  paused: string[];
  resumed: string[];
  completed: string[];
  reprioritized: Array<{ missionId: string; priority: number }>;
  highestValueMissionId: string | null;
  progress: number;
  objectiveStatus: string;
  prioritiesPublished: number;
  skipped?: string;
};

/**
 * Run one PERCEIVE → REASON → APPLY cycle for a single objective and persist the
 * result. `force` bypasses the re-review interval (used by on-demand planning).
 */
export async function planObjective(objectiveId: string, opts: { force?: boolean } = {}): Promise<PlanResult> {
  const empty = (extra: Partial<PlanResult> = {}): PlanResult => ({
    ok: false, objectiveId, created: [], paused: [], resumed: [], completed: [],
    reprioritized: [], highestValueMissionId: null, progress: 0, objectiveStatus: "active",
    prioritiesPublished: 0, ...extra,
  });

  const objective = await getObjective(objectiveId);
  if (!objective) return empty({ reason: "objective not found" });
  if (objective.status !== "active" && !opts.force) return empty({ skipped: `objective is ${objective.status}`, progress: objective.progress ?? 0, objectiveStatus: objective.status });
  if (!opts.force && objective.lastReviewedAt && Date.now() - objective.lastReviewedAt < MIN_REVIEW_INTERVAL_MS) {
    return empty({ skipped: "reviewed recently", progress: objective.progress ?? 0, objectiveStatus: objective.status });
  }
  if (!key()) return empty({ reason: "no OPENAI_API_KEY — planner needs the model to reason" });

  // PERCEIVE
  const allMissions = await listMissionViews();
  const mine = allMissions.filter((m) => m.objectiveId === objectiveId);
  const mineById = new Map(mine.map((m) => [m.id, m]));
  const memory = await buildBrainContext();

  // REASON
  let plan: RawPlan;
  try {
    plan = await reason(objective, mine, memory);
  } catch (e: any) {
    return empty({ reason: `reasoning failed: ${String(e?.message || e).slice(0, 160)}` });
  }

  // APPLY
  const openCount = mine.filter((m) => OPEN.has(m.status)).length;
  const objWeight = Math.max(1, Math.min(5, objective.priority || 3));
  const created: PlanResult["created"] = [];
  let highestValueMissionId: string | null = null;

  // 1. Create new missions — deduped against existing OPEN missions + capped.
  const openTexts = mine.filter((m) => OPEN.has(m.status)).map((m) => m.objective);
  const wantCreate = (Array.isArray(plan.createMissions) ? plan.createMissions : [])
    .map((c) => ({ ...c, _text: missionText(c) }))
    .filter((c) => c._text.length > 3)
    .slice(0, MAX_NEW_MISSIONS_PER_CYCLE);
  for (const c of wantCreate) {
    if (openCount + created.length >= MAX_OPEN_MISSIONS_PER_OBJECTIVE) break; // capacity guard
    const text = c._text;
    const dup = [...openTexts, ...created.map((x) => x.objective)].some((t) => jaccard(t, text) >= DEDUP_JACCARD);
    if (dup) continue; // don't spawn near-duplicate work — the core anti-loop guard
    const immediate = (c as any).immediate !== false;
    const highestValue = Boolean((c as any).highestValue);
    // priority: objective weight dominates; the single highest-value mission gets a strong boost.
    const priority = objWeight * 2 + (highestValue ? 12 : immediate ? 4 : 0);
    const m = await createMission(text, {
      objectiveId,
      brandId: objective.brandId ?? null, // missions inherit the objective's brand
      priority,
      scheduledFor: immediate ? undefined : Date.now() + 30 * 60_000,
    });
    created.push({ id: m.id, objective: text, immediate, highestValue, priority });
    if (highestValue) highestValueMissionId = m.id;
  }

  // 2. Pause / resume / complete existing missions (only ones that belong to this objective).
  const paused: string[] = [];
  for (const id of (plan.pauseMissionIds || []).filter((x) => mineById.has(x))) {
    if (await pauseMission(id, "Objective Planner: no longer the highest-value work")) paused.push(id);
  }
  const resumed: string[] = [];
  for (const id of (plan.resumeMissionIds || []).filter((x) => mineById.has(x))) {
    if (await resumeMission(id)) resumed.push(id);
  }
  const completed: string[] = [];
  for (const id of (plan.completeMissionIds || []).filter((x) => mineById.has(x))) {
    const m = mineById.get(id)!;
    if (!TERMINAL.has(m.status)) { await cancelMission(id); completed.push(id); }
  }

  // 3. Reprioritize existing missions.
  const reprioritized: PlanResult["reprioritized"] = [];
  for (const r of (plan.reprioritize || [])) {
    if (!r?.missionId || !mineById.has(r.missionId)) continue;
    const p = Math.round(Number(r.priority) || 0);
    if (await reprioritizeMission(r.missionId, p, "Objective Planner")) reprioritized.push({ missionId: r.missionId, priority: p });
  }

  // 4. Determine highest-value mission if the model didn't create one: boost the
  //    best existing open mission so the OS always has a clear "do this next".
  let highestValueText: string | null = created.find((c) => c.id === highestValueMissionId)?.objective ?? null;
  if (!highestValueMissionId) {
    const openNow = (await listMissionViews()).filter((m) => m.objectiveId === objectiveId && OPEN.has(m.status));
    const boostTarget = openNow.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
    if (boostTarget) {
      const boost = objWeight * 2 + 12;
      if ((boostTarget.priority ?? 0) < boost) await reprioritizeMission(boostTarget.id, boost, "Objective Planner: highest-value next step");
      highestValueMissionId = boostTarget.id;
      highestValueText = boostTarget.objective;
    }
  }

  // 5. Publish this objective's slice of the Priority Queue. If the model returned
  //    no explicit priorities, the highest-value next mission IS a priority — so the
  //    objective always surfaces at least one concrete "do this next" in the queue.
  let priorityItems: any[] = Array.isArray(plan.priorities) ? plan.priorities.filter((p) => p && (p.title || p.recommendedAction)) : [];
  if (!priorityItems.length && highestValueText) {
    priorityItems = [{
      title: `Advance: ${objective.title}`,
      category: "mission",
      urgency: objWeight, importance: objWeight,
      recommendedAction: highestValueText,
      why: String(plan.reasoning || `Highest-value next step to move "${objective.title}" forward.`).slice(0, 300),
      source: `objective:${objective.title}`,
    }];
  }
  const pub = await replaceObjectivePriorities(objectiveId, priorityItems);

  // 6. Persist the evolving objective state.
  const progress = Math.max(0, Math.min(100, Math.round(Number(plan.progress) ?? objective.progress ?? 0)));
  const nextStatus = ["active", "paused", "done"].includes(String(plan.objectiveStatus)) ? (plan.objectiveStatus as Objective["status"]) : objective.status;
  const stateSummary = String(plan.stateSummary || objective.state || "").slice(0, 600);
  await patchObjective(objectiveId, {
    state: stateSummary || "reviewed",
    progress,
    status: nextStatus,
    lastReviewedAt: Date.now(),
  });

  return {
    ok: true,
    objectiveId,
    reason: String(plan.reasoning || "").slice(0, 400),
    created, paused, resumed, completed, reprioritized,
    highestValueMissionId,
    progress,
    objectiveStatus: nextStatus,
    prioritiesPublished: pub.ranked,
  };
}

/**
 * Evaluate EVERY active objective (the kernel heartbeat). Sequential so we never
 * stampede the model API; each objective is independently guarded by the
 * re-review interval, so this is cheap to call often.
 */
export async function planAllObjectives(opts: { force?: boolean } = {}): Promise<{ ok: boolean; planned: PlanResult[]; count: number }> {
  const actives = await listActiveObjectives();
  const planned: PlanResult[] = [];
  for (const o of actives) {
    try {
      planned.push(await planObjective(o.id, opts));
    } catch (e: any) {
      planned.push({
        ok: false, objectiveId: o.id, reason: String(e?.message || e).slice(0, 160),
        created: [], paused: [], resumed: [], completed: [], reprioritized: [],
        highestValueMissionId: null, progress: o.progress ?? 0, objectiveStatus: o.status, prioritiesPublished: 0,
      });
    }
  }
  return { ok: true, planned, count: planned.filter((p) => p.ok).length };
}
