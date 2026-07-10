import { uid, dbBackend, setWorkerHeartbeat } from "@/lib/server/db";
import {
  createMissionRow,
  getMission,
  listMissionViews,
  listRunnable,
  claimMission,
  extendLease,
  releaseLease,
  patchMission,
  addStep as storeAddStep,
  pushApi as storePushApi,
  clearApi,
  trimTerminalApi,
  cancelMissionRow,
  pruneMissions as storePrune,
} from "@/lib/server/missionStore";
import { getServerTool, serverToolSchemas } from "@/lib/server/tools";
import { buildBrainContext } from "@/lib/server/data";
import type { Mission, MissionStep, MissionApiMsg } from "@/lib/missionTypes";

export { getMission };

/**
 * Server mission engine — persistent, autonomous execution.
 *
 * The user states an objective; this plans, executes capabilities step by
 * step, monitors its own work with a quality-control pass, and reports back.
 * It runs in a dedicated worker process (worker.ts) — and, as a fallback, in
 * the web server itself unless DISABLE_WORKER is set — so missions continue
 * regardless of whether the app is open. All state is persisted, so a restart
 * resumes missions exactly where they left off.
 */

const MAX_TURNS = 22; // research missions need room to search + read several sources
const MAX_ATTEMPTS = 5; // bounded auto-retry of a mission that fails (transient errors)
const RETRY_BASE_MS = 30_000; // first backoff delay
const RETRY_MAX_MS = 5 * 60_000; // cap so backoff can't grow unbounded

/** Exponential backoff with light jitter: ~30s, 60s, 120s, 240s … capped at 5m.
 *  The jitter avoids a thundering herd of retries lining up on the same tick. */
function backoffMs(attempts: number): number {
  const exp = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
  const jitter = 0.85 + Math.random() * 0.3; // ±15%
  return Math.round(exp * jitter);
}
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// Cross-process execution lease. A worker holds a mission for LEASE_MS and
// refreshes it around every blocking step; if it dies, the lease lapses and
// another worker reclaims the mission. Kept comfortably above the longest single
// blocking step (the 90s model-call timeout) so a live worker never loses its
// own lease mid-turn.
const WORKER_ID = uid(); // unique per worker process
const LEASE_MS = 120_000;

function model() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}
function key() {
  return process.env.OPENAI_API_KEY || "";
}

/** Structured, greppable status-transition log (worker stdout → platform logs).
 *  Every mission state change flows through here so interruption + recovery is
 *  observable end to end. */
function logT(id: string, transition: string, note = "") {
  // eslint-disable-next-line no-console
  console.log(`[Evolution OS][transition] mission=${id} ${transition}${note ? ` (${note})` : ""}`);
}

/* ---- persistence helpers — thin aliases over the row-scoped mission store ---- */
const patch = (id: string, p: Partial<Mission>) => patchMission(id, p);
const addStep = (id: string, step: Omit<MissionStep, "id" | "ts">) => storeAddStep(id, step);
const pushApi = (id: string, msg: MissionApiMsg) => storePushApi(id, msg);

/** Append a durable, timestamped STATUS entry to the mission log (Queued /
 *  Running / Waiting / Completed / Failed) AND mirror it to the worker stdout
 *  log. This is the persistent mission-status history. */
async function logStatus(id: string, label: string, detail?: string) {
  await addStep(id, { kind: "status", text: label, detail });
  logT(id, `→ ${label}`, detail || "");
}

export async function createMission(
  objective: string,
  opts: { scheduledFor?: number; recurrence?: { everyMs: number }; trigger?: { rule: string; event: string }; objectiveId?: string | null; priority?: number } = {}
): Promise<Mission> {
  const scheduled = opts.scheduledFor && opts.scheduledFor > Date.now() ? opts.scheduledFor : undefined;
  const m: Mission = {
    id: uid(),
    objective,
    objectiveId: opts.objectiveId ?? null,
    priority: Math.round(Number(opts.priority) || 0),
    status: "queued",
    steps: [
      { id: uid(), ts: Date.now(), kind: "status", text: "Queued", detail: scheduled ? `scheduled for ${new Date(scheduled).toISOString()}` : undefined },
      // Record the triggering event so the Mission Queue shows why this ran.
      ...(opts.trigger ? [{ id: uid(), ts: Date.now(), kind: "plan" as const, text: `⚡ Triggered by rule “${opts.trigger.rule}”`, detail: opts.trigger.event }] : []),
      {
        id: uid(),
        ts: Date.now(),
        kind: "plan",
        text: scheduled ? `Scheduled for ${new Date(scheduled).toISOString()}` : "Mission accepted",
      },
    ],
    api: [{ role: "user", content: objective }],
    pending: [],
    qcLeft: 2,
    attempts: 0,
    acknowledged: false,
    scheduledFor: scheduled,
    recurrence: opts.recurrence,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await createMissionRow(m);
  logT(m.id, "created → queued", scheduled ? `scheduled ${new Date(scheduled).toISOString()}` : "");
  return m;
}

/** Mark a completed mission as seen — durable, so results are never lost and
 *  "results waiting" is consistent across devices and restarts. */
export async function setMissionAcknowledged(id: string, acknowledged: boolean) {
  await patch(id, { acknowledged });
}

/* ---- model calls ---- */
async function callModel(messages: MissionApiMsg[], opts: { tools?: boolean; json?: boolean } = {}) {
  if (!key()) throw new Error("Server has no OPENAI_API_KEY configured.");
  const body: any = { model: model(), messages, temperature: 0.4 };
  if (opts.tools) {
    body.tools = serverToolSchemas();
    body.tool_choice = "auto";
  }
  if (opts.json) body.response_format = { type: "json_object" };

  // one retry on transient failure; hard timeout so a turn can never hang
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        lastErr = (await res.text().catch(() => "")) || `HTTP ${res.status}`;
        if (res.status >= 500 || res.status === 429) continue; // retry
        throw new Error(lastErr.slice(0, 300));
      }
      const data = await res.json();
      return data.choices?.[0]?.message ?? { role: "assistant", content: "" };
    } catch (e: any) {
      lastErr = e?.name === "AbortError" ? "model call timed out" : e?.message || "network error";
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Model call failed: " + lastErr.slice(0, 200));
}

const MISSION_SYSTEM = (context: string) =>
  "You are Evolution OS executing a long-running MISSION autonomously on the server. " +
  "The user delegated this objective and walked away — they are NOT watching and cannot answer " +
  "questions or approve anything. The objective is your authorization: take the actions it implies " +
  "(send the email, create the event, read the page) directly, without asking. " +
  "Make reasonable assumptions and finish the work.\n" +
  "Work step by step using the available capabilities until the objective is fully accomplished. " +
  "Each assistant message before you finish is one short progress line.\n" +
  "Do NOT repeat an action you've already completed — check the tool results in the conversation " +
  "before acting (e.g. never send the same email twice).\n" +
  "CRITICAL honesty: only claim what you actually did. If a capability failed or isn't available " +
  "(e.g. Google not connected), say so plainly — never fabricate results, research, or actions.\n" +
  "When fully done, send a final message with NO tool calls. This final message IS the deliverable " +
  "the user reads — it must contain the actual RESULT (the findings, the ranked list, the answer), " +
  "not a description of what you saved or revised. Include the key results inline, list any " +
  "externally-visible actions you took (emails sent, events created), and note where fuller detail " +
  "was saved (e.g. a note) if relevant.\n" +
  "\nRESEARCH method (when the objective requires finding information): " +
  "(1) run several web_search queries with different angles to find sources; " +
  "(2) fetch_url the most promising results and read the actual content from MULTIPLE sources; " +
  "(3) extract concrete facts and keep the source URL for each; " +
  "(4) analyze and synthesize into a clear, ranked report, citing the source URL for each item; " +
  "(5) aim for the count or scope the user asked for. " +
  "NEVER invent specifics — prices, addresses, names, counts, or listings you did not actually read. " +
  "If you can only verify fewer items than requested, return the verified ones with their sources and " +
  "state plainly how many you confirmed and what limited the rest. A short, honest, sourced report " +
  "beats a long fabricated one.\n" +
  (context ? "\nWhat Evolution already knows:\n" + context : "");

function parseArgs(call: any) {
  try { return JSON.parse(call.function?.arguments || "{}"); } catch { return {}; }
}

/** Stable signature for a tool call, so identical actions can be deduped. */
function callSignature(name: string, args: any): string {
  const stable = (v: any): any =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.keys(v).sort().reduce((o: any, k) => ((o[k] = stable(v[k])), o), {})
      : v;
  return name + ":" + JSON.stringify(stable(args));
}

/**
 * Idempotency guard. If an identical call already executed successfully earlier
 * in this mission (e.g. a QC revision re-tried it), return true so we DON'T run
 * it again — this is what stops duplicate emails / duplicate writes.
 */
async function alreadyExecuted(id: string, name: string, args: any): Promise<boolean> {
  const sig = callSignature(name, args);
  const m = await getMission(id);
  if (!m) return false;
  const okById: Record<string, boolean> = {};
  for (const msg of m.api) {
    if (msg.role === "tool" && msg.tool_call_id) {
      try { okById[msg.tool_call_id] = JSON.parse(msg.content || "{}")?.ok !== false; }
      catch { okById[msg.tool_call_id] = true; }
    }
  }
  for (const msg of m.api) {
    if (msg.role !== "assistant" || !msg.tool_calls) continue;
    for (const c of msg.tool_calls) {
      if (
        c.function?.name === name &&
        callSignature(name, parseArgs(c)) === sig &&
        okById[c.id]
      ) {
        return true;
      }
    }
  }
  return false;
}

/* ---- tool execution: automatic retry + output logging ---- */
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TOOL_MAX_TRIES = 3;

/** A tool failure is RECOVERABLE (worth an automatic retry) when it looks
 *  transient — a timeout, network blip, rate limit, or upstream 5xx. Permanent
 *  errors (bad input, "not connected", invalid URL) are NOT retried. */
function recoverable(err: string): boolean {
  return /timed out|timeout|network|ECONN|socket|fetch failed|temporar|rate limit|429|\b5\d\d\b|unavailable|reset|EAI_AGAIN/i.test(err || "");
}

/** Run a tool with bounded auto-retry on recoverable failures. */
async function runTool(tool: any, args: any): Promise<{ result: any; tries: number }> {
  let result: any = { ok: false, error: "Tool did not run" };
  for (let t = 1; t <= TOOL_MAX_TRIES; t++) {
    try {
      result = await tool.execute(args);
    } catch (e: any) {
      result = { ok: false, error: e?.message || "Failed" };
    }
    const failed = result?.ok === false;
    if (failed && recoverable(String(result.error || "")) && t < TOOL_MAX_TRIES) {
      await sleepMs(700 * t);
      continue;
    }
    return { result, tries: t };
  }
  return { result, tries: TOOL_MAX_TRIES };
}

/** A concise, human-readable summary of a tool's OUTPUT for the mission timeline. */
function toolOutcome(name: string, r: any): string {
  if (!r || r.ok === false) return "";
  switch (name) {
    case "web_search": return `${r.count ?? r.results?.length ?? 0} results (${r.provider || "web"})`;
    case "fetch_url": return `read ${r.text?.length ?? 0} chars from ${r.url || "page"}`;
    case "read_recent_email": return `${r.count ?? 0} message(s)`;
    case "list_calendar": return `${r.count ?? 0} event(s) over ${r.days ?? "?"}d`;
    case "read_note": return r.found ? `read ${r.length ?? 0} chars from “${r.title}”` : "no matching note";
    case "send_email": return `sent to ${r.emailedTo || ""}`;
    case "draft_email": return r.deduped ? "draft already existed" : `Gmail draft → ${r.to || ""}`;
    case "create_calendar_event": return `event created${r.link ? "" : ""}`;
    case "suggest_calendar_event": return r.deduped ? "already queued" : "queued for approval";
    case "create_note": return r.updated ? `updated note “${r.updated}”` : `saved note “${r.created}”`;
    case "create_task": return r.existing ? "task already existed" : `task added`;
    case "add_contact": return r.updated ? `contact updated` : `contact added`;
    case "update_deal_stage": return `deal → ${r.stage || ""}`;
    case "save_memory": return r.existing ? "already remembered" : "remembered";
    case "search_data": return "searched the brain";
    case "set_priorities": return `${r.ranked ?? 0} priorities ranked`;
    case "list_pending_work": return `${r.openTasks ?? 0} tasks · ${r.activeMissions ?? 0} missions`;
    default: return typeof r.note === "string" ? r.note.slice(0, 80) : "done";
  }
}

async function executeCall(id: string, call: any, approved: boolean) {
  const name = call.function?.name as string;
  const args = parseArgs(call);
  const tool = getServerTool(name);
  let result: any;
  if (!approved) {
    result = { ok: false, declined: true };
    await addStep(id, { kind: "action", text: `Declined: ${tool?.summarize(args) || name}` });
  } else if (!tool) {
    result = { ok: false, error: `Capability "${name}" is not available in background missions yet.` };
    await addStep(id, { kind: "error", text: `Unavailable capability: ${name}` });
  } else if (await alreadyExecuted(id, name, args)) {
    // Same action already done — never repeat a side effect.
    result = { ok: true, skipped: true, note: "Already completed earlier in this mission." };
    await addStep(id, { kind: "action", text: `${tool.summarize(args)} (already done)` });
  } else {
    // Run the real tool, auto-retrying transient failures, and LOG its output.
    const { result: r, tries } = await runTool(tool, args);
    result = r;
    const ok = result?.ok !== false;
    let detail = ok ? toolOutcome(name, result) : String(result.error || "Failed");
    if (tries > 1) detail = (detail ? detail + " " : "") + `(auto-retried ×${tries - 1})`;
    await addStep(id, { kind: ok ? "action" : "error", text: tool.summarize(args), detail: detail || undefined });
  }
  await pushApi(id, { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
}

/** Returns true if the mission paused for approval. */
async function processCalls(id: string, calls: any[]): Promise<boolean> {
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const tool = getServerTool(call.function?.name);
    if (tool?.requiresApproval) {
      const pending = calls.slice(i).map((c) => ({
        call: c,
        summary: getServerTool(c.function?.name)?.summarize(parseArgs(c)) || c.function?.name,
      }));
      await patch(id, { status: "needs_approval", pending });
      await addStep(id, { kind: "progress", text: "Waiting for your approval", detail: tool.summarize(parseArgs(call)) });
      await logStatus(id, "Waiting", "approval required");
      return true;
    }
    await executeCall(id, call, true);
  }
  return false;
}

/* ---- quality control before reporting back ---- */
async function verify(objective: string, actions: string[], report: string) {
  const sys: MissionApiMsg = {
    role: "system",
    content:
      "You are a strict quality controller for Evolution OS. Given an OBJECTIVE, the ACTIONS that " +
      "were actually executed (with results), and a PROPOSED REPORT to the user, decide whether the " +
      "objective was genuinely accomplished and whether EVERY claim in the report is supported by the " +
      "actions. Be skeptical.\n" +
      "Rules:\n" +
      "- If the report claims an action that was not actually executed, it FAILS.\n" +
      "- The ACTIONS list is a TERSE log — it names each executed action but may omit the parameters " +
      "(a task's priority, a note's body, an event's time). An action shown here executed SUCCESSFULLY " +
      "and applied the parameters the OBJECTIVE specified. Do NOT mark a report as unsupported merely " +
      "because a terse action line doesn't restate an argument; only FAIL claims that CONTRADICT the " +
      "actions or describe something never attempted. (E.g. objective says priority high + a create-task " +
      "action ran ⇒ 'created with high priority' is SUPPORTED and should PASS.)\n" +
      "- For RESEARCH reports: specific facts (prices, addresses, names, listings, figures) must be " +
      "grounded in sources actually read via fetch_url. Fabricated or uncited specifics FAIL. " +
      "Inventing items to hit a requested count (e.g. padding to 20) FAILS — an honest report of fewer, " +
      "verified items with sources PASSES.\n" +
      "- A report that truthfully states what could and could not be verified PASSES.\n" +
      'Respond ONLY as JSON: {"verdict":"pass"|"revise","issues":[string],"guidance":string}.',
  };
  const user: MissionApiMsg = {
    role: "user",
    content:
      `OBJECTIVE:\n${objective}\n\nACTIONS ACTUALLY EXECUTED:\n` +
      (actions.length ? actions.map((a) => `- ${a}`).join("\n") : "(none)") +
      `\n\nPROPOSED REPORT:\n${report}`,
  };
  const msg = await callModel([sys, user], { json: true });
  try {
    return JSON.parse(msg.content || "{}");
  } catch {
    return { verdict: "pass", issues: [], guidance: "" };
  }
}

async function finalize(id: string, candidate: string) {
  const m = await getMission(id);
  if (!m) return;
  const report = (candidate || "Completed.").trim();
  const actions = m.steps
    .filter((s) => s.kind === "action")
    .map((s) => s.text + (s.detail ? ` — ${s.detail}` : ""));

  if (m.qcLeft > 0) {
    await addStep(id, { kind: "progress", text: "Quality check" });
    let verdict: any = null;
    try { verdict = await verify(m.objective, actions, report); } catch { verdict = null; }

    if (verdict && verdict.verdict === "revise") {
      await patch(id, { qcLeft: m.qcLeft - 1 });
      const issues = (verdict.issues || []).join("; ");
      await addStep(id, { kind: "progress", text: "Quality check: revising", detail: issues.slice(0, 160) });
      await pushApi(id, {
        role: "user",
        content:
          `Quality control review: the objective is NOT yet fully met. Issues: ${issues}. ` +
          `${verdict.guidance || ""} ` +
          `Only take a NEW action if one is genuinely still missing — do not repeat work already done ` +
          `(the tool results above show what is complete). If the gap is only in how you described it, ` +
          `just rewrite the final report accurately. If something truly cannot be done, state that ` +
          `plainly instead of claiming it was done.`,
      });
      await runMission(id); // keep working
      return;
    }
    await addStep(id, { kind: "progress", text: "Quality check passed" });
  }

  await addStep(id, { kind: "result", text: report });
  // Drop the heavy model-conversation history on completion. It's only needed
  // for in-flight resume; keeping it bloats the store as missions accumulate.
  await patch(id, { status: "done", result: report, pending: [] });
  await clearApi(id);
  await releaseLease(id);
  await logStatus(id, "Completed");

  // Recurring missions queue their next run — but re-read first, so a mission
  // canceled mid-run (recurrence cleared) does NOT spawn another occurrence.
  const fresh = await getMission(id);
  if (fresh?.recurrence?.everyMs) {
    await createMission(m.objective, {
      scheduledFor: Date.now() + fresh.recurrence.everyMs,
      recurrence: fresh.recurrence,
    });
  }
}

/* ---- the main loop ---- */
export async function runMission(id: string) {
  const startMission = await getMission(id);
  if (!startMission || startMission.status === "done" || startMission.status === "failed") return;
  await patch(id, { status: "running" });
  const context = await buildBrainContext();

  try {
    // Resume after a user approval decision (recorded by approveMission on the
    // web tier). The worker — not the web — applies it and executes.
    const resume = await getMission(id);
    if (resume?.pending?.length && (resume.pendingDecision === true || resume.pendingDecision === false)) {
      const decision = resume.pendingDecision;
      const [head, ...rest] = resume.pending;
      await patch(id, { pending: [], pendingDecision: null });
      await executeCall(id, head.call, decision);
      const paused = await processCalls(id, rest.map((p) => p.call));
      if (paused) { await releaseLease(id); return; } // another approval needed
    }

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // Refresh the execution lease each turn. If we no longer own it, another
      // worker reclaimed this mission (we were presumed dead) — stop immediately
      // so two workers never finish the same mission.
      if (!(await extendLease(id, WORKER_ID, LEASE_MS))) return;

      const m = await getMission(id);
      if (!m) return;

      const system: MissionApiMsg = { role: "system", content: MISSION_SYSTEM(context) };
      const message = await callModel([system, ...m.api], { tools: true });
      // The model call is the longest blocking step. Re-check ownership BEFORE
      // writing anything back: if the lease lapsed during the call and another
      // worker reclaimed the mission, bail without touching its api history.
      if (!(await extendLease(id, WORKER_ID, LEASE_MS))) return;
      const calls: any[] = message.tool_calls || [];
      await pushApi(id, {
        role: "assistant",
        content: message.content ?? "",
        tool_calls: calls.length ? calls : undefined,
      });
      if (message.content && message.content.trim() && calls.length) {
        await addStep(id, { kind: "progress", text: message.content.trim() });
      }

      if (!calls.length) {
        await finalize(id, message.content || "Completed.");
        return;
      }

      const paused = await processCalls(id, calls);
      if (paused) { await releaseLease(id); return; } // resumes via approveMission
    }
    await finalize(id, "Reached the mission step limit; reporting partial progress.");
  } catch (e: any) {
    const msg = e?.message || "Mission failed.";
    const m = await getMission(id);
    // If the mission was canceled or already finalized while this run was in
    // flight, do NOT resurrect it via retry.
    if (!m || m.status === "done") return;
    const attempts = (m.attempts ?? 0) + 1;
    await addStep(id, { kind: "error", text: msg });
    if (attempts < MAX_ATTEMPTS) {
      // Transient failure → re-queue with EXPONENTIAL backoff. Safe to re-run:
      // the idempotency guard skips any action already completed this mission.
      const delay = backoffMs(attempts);
      await addStep(id, { kind: "progress", text: `Auto-retry ${attempts + 1}/${MAX_ATTEMPTS} in ${Math.round(delay / 1000)}s (exponential backoff)` });
      await patch(id, {
        status: "queued",
        attempts,
        pending: [],
        scheduledFor: Date.now() + delay,
      });
      await releaseLease(id); // free it for re-claim (possibly by another worker)
      await logStatus(id, "Queued", `auto-retry ${attempts + 1}/${MAX_ATTEMPTS} in ${Math.round(delay / 1000)}s (exponential backoff) after: ${msg.slice(0, 60)}`);
    } else {
      await patch(id, { status: "failed", attempts, result: msg });
      await clearApi(id);
      await releaseLease(id);
      await logStatus(id, "Failed", `${attempts} attempts exhausted`);
    }
  }
}

/**
 * Record the user's approval decision and hand the mission back to the worker.
 * Execution never happens here (this may run on the stateless web tier) — the
 * worker picks the re-queued mission up and applies the decision on resume.
 */
export async function cancelMission(id: string) {
  await cancelMissionRow(id);
}

/* ---- Objective-Planner lifecycle controls ----
 * The planner reconciles existing work with fresh reasoning each cycle: it can
 * PAUSE a mission that no longer serves its objective, RESUME one that regained
 * value, and REPRIORITIZE so the highest-value mission for each objective runs
 * first. A paused mission is non-runnable (listRunnable selects only queued/
 * running) until resumed — no lease is held, so it never blocks a worker. */

/** Pause a not-yet-started mission (queued or awaiting approval). Running/terminal
 *  missions are left alone — we never yank work out from under a live worker. */
export async function pauseMission(id: string, reason?: string): Promise<boolean> {
  const m = await getMission(id);
  if (!m || !["queued", "needs_approval"].includes(m.status)) return false;
  await patch(id, { status: "paused" });
  await logStatus(id, "Paused", reason || "deprioritized by Objective Planner");
  return true;
}

/** Resume a paused mission back into the queue. Preserves the mission's existing
 *  schedule (so a deferred mission doesn't jump to run immediately); pass an
 *  explicit scheduledFor only to override it. */
export async function resumeMission(id: string, scheduledFor?: number): Promise<boolean> {
  const m = await getMission(id);
  if (!m || m.status !== "paused") return false;
  const p: Partial<Mission> = { status: "queued" };
  if (scheduledFor !== undefined) p.scheduledFor = scheduledFor > Date.now() ? scheduledFor : undefined;
  await patch(id, p);
  await logStatus(id, "Queued", "resumed by Objective Planner");
  return true;
}

/** Set a mission's claim priority (higher = claimed sooner among due work). */
export async function reprioritizeMission(id: string, priority: number, reason?: string): Promise<boolean> {
  const m = await getMission(id);
  if (!m || ["done", "failed"].includes(m.status)) return false;
  const p = Math.round(Number(priority) || 0);
  if ((m.priority ?? 0) === p) return true;
  await patch(id, { priority: p });
  await logT(id, `reprioritized → ${p}`, reason || "");
  return true;
}

export async function approveMission(id: string, approved: boolean) {
  const m = await getMission(id);
  if (!m || m.status !== "needs_approval" || !m.pending.length) return;
  await patch(id, { status: "queued", scheduledFor: undefined, pendingDecision: approved });
}

// Keep the store bounded on a long-running persistent OS. Pruning drops only the
// oldest TERMINAL missions beyond the cap; work products live in their own brain
// collections, so a pruned mission log loses nothing real. (Implemented in the
// mission store so it's a single indexed DELETE, not a whole-store rewrite.)
const MISSION_CAP = 1000;

/* ---- the autonomous kernel: the OS's own heartbeat (M2: Objective Reasoning) ----
 *
 * The kernel is no longer a single global "briefing" mission. It is a per-objective
 * PLANNER: on a cadence it evaluates EVERY active objective and decides the work
 * that should exist — creating, pausing, resuming, completing, and reprioritizing
 * missions, and keeping each objective's evolving `state` + Priority-Queue slice
 * current (see objectivePlanner.ts). Everything it spawns runs through this same
 * persistent, exactly-once engine and still cannot act outward without approval.
 * Opt-in (ongoing model spend): off until KERNEL_ENABLED=true; cadence via
 * KERNEL_EVERY_MIN. Each objective is additionally rate-limited by the planner's
 * own re-review interval, so a fast cadence is safe and cheap. */
const KERNEL_MARKER = "[KERNEL]"; // legacy global-briefing missions to retire
const KERNEL_EVERY_MS = Math.max(5, Number(process.env.KERNEL_EVERY_MIN) || 240) * 60_000;

/** Retire any legacy global-briefing kernel missions from a previous deploy. The
 *  reasoning loop is now the objective planner running in the worker heartbeat —
 *  the old recurring briefing mission would otherwise keep re-spawning global
 *  triage and clobbering the objective-scoped Priority Queue. */
async function ensureKernel() {
  const views = await listMissionViews();
  const legacy = views.filter(
    (v) => v.objective.startsWith(KERNEL_MARKER) && v.status !== "done" && v.status !== "failed"
  );
  for (const v of legacy) await cancelMission(v.id);
  if (legacy.length) {
    // eslint-disable-next-line no-console
    console.log(`[Evolution OS] retired ${legacy.length} legacy briefing kernel(s) — reasoning is now per-objective`);
  }
}

/** One heartbeat of the reasoning loop: plan every active objective. Guarded by
 *  KERNEL_ENABLED; each objective is rate-limited inside the planner. */
async function runKernelPlanning() {
  if (process.env.KERNEL_ENABLED !== "true") return;
  const { planAllObjectives } = await import("@/lib/server/objectivePlanner");
  const r = await planAllObjectives();
  if (r.count) {
    // eslint-disable-next-line no-console
    console.log(`[Evolution OS] objective planner: reviewed ${r.count} objective(s)`);
  }
}

/* ---- background worker ---- */
let workerStarted = false;
const inflight = new Set<string>();
const MAX_CONCURRENT = 3; // bound fan-out so missions don't stampede the model API

export function startWorker() {
  if (workerStarted) return;
  // Allow a deployment to disable the in-process worker (e.g. when running a
  // dedicated worker component). Default: enabled.
  if (process.env.DISABLE_WORKER === "true") return;
  workerStarted = true;

  // Shrink any historical bloat once on boot (non-blocking).
  trimTerminalApi().catch(() => {});
  storePrune(MISSION_CAP).catch(() => {});
  ensureKernel().catch(() => {}); // the OS's heartbeat (opt-in via KERNEL_ENABLED)

  const claim = (id: string) => {
    inflight.add(id);
    runMission(id)
      .catch(() => {}) // never let a rejection escape the worker
      .finally(() => inflight.delete(id));
  };

  let lastBeat = 0;
  let lastPrune = 0;
  let lastEvents = 0;
  let lastPlan = 0;
  const tick = async () => {
    try {
      // Throttled liveness beat so /api/health can confirm the runtime is alive.
      if (Date.now() - lastBeat > 15_000) {
        lastBeat = Date.now();
        await setWorkerHeartbeat().catch(() => {});
      }
      // Keep the store bounded on a long-running OS — check occasionally, not
      // every tick (pruning is a no-op until MISSION_CAP is exceeded).
      if (Date.now() - lastPrune > 5 * 60_000) {
        lastPrune = Date.now();
        await storePrune(MISSION_CAP).catch(() => {});
      }
      // Event engine: react to Gmail/Calendar/schedule rules and queue triggered
      // missions. Throttled so we don't hammer the integrations.
      if (Date.now() - lastEvents > 90_000) {
        lastEvents = Date.now();
        (await import("@/lib/server/eventEngine")).runEventEngine().catch(() => {});
      }
      // Objective Planner heartbeat (M2): re-reason every active objective on the
      // kernel cadence. Each objective is further rate-limited inside the planner,
      // so this only spends model tokens when an objective is actually due.
      if (process.env.KERNEL_ENABLED === "true" && Date.now() - lastPlan > KERNEL_EVERY_MS) {
        lastPlan = Date.now();
        runKernelPlanning().catch(() => {});
      }
      // Candidates: queued-and-due work, plus missions whose worker died (lapsed
      // lease). We ATOMICALLY claim each before running it, so across any number
      // of worker processes exactly one wins the row — the DB, not this in-memory
      // set, is the source of truth. The inflight set is just a local fast-path
      // so we don't issue a claim for something we're already running.
      const candidates = await listRunnable(Date.now());
      for (const m of candidates) {
        if (inflight.size >= MAX_CONCURRENT) break;
        if (inflight.has(m.id)) continue;
        const won = await claimMission(m.id, WORKER_ID, LEASE_MS);
        if (won) {
          // status 'running' here means the previous worker died mid-execution
          // and we're reclaiming its lapsed lease — i.e. recovery after interrupt.
          if (m.status === "running") await logStatus(m.id, "Running", `recovered after interruption; resuming on worker ${WORKER_ID}`);
          else await logStatus(m.id, "Running", `worker ${WORKER_ID}`);
          claim(m.id);
        }
      }
    } catch {
      /* keep the worker alive no matter what */
    }
  };

  setInterval(tick, 2000);
  tick();
  // eslint-disable-next-line no-console
  console.log(`[Evolution OS] mission worker started (store: ${dbBackend()})`);
}
