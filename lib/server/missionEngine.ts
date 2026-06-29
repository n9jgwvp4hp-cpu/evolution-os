import { mutate, getMission, listMissions, uid, dbBackend, setWorkerHeartbeat } from "@/lib/server/db";
import { getServerTool, serverToolSchemas } from "@/lib/server/tools";
import { buildBrainContext } from "@/lib/server/data";
import type { Mission, MissionStep, MissionApiMsg } from "@/lib/missionTypes";

/**
 * Server mission engine — persistent, autonomous execution.
 *
 * The user states an objective; this plans, executes capabilities step by
 * step, monitors its own work with a quality-control pass, and reports back.
 * It runs in the server process (started by instrumentation.ts) so missions
 * continue regardless of whether the app is open. All state is persisted, so
 * a restart resumes missions exactly where they left off.
 */

const MAX_TURNS = 22; // research missions need room to search + read several sources
const MAX_ATTEMPTS = 3; // bounded auto-retry of a mission that fails (transient errors)
const RETRY_DELAY_MS = 30_000; // back off before re-running a failed mission
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function model() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}
function key() {
  return process.env.OPENAI_API_KEY || "";
}

/* ---- persistence helpers (all go through the durable store) ---- */
async function patch(id: string, p: Partial<Mission>) {
  await mutate((db) => {
    const m = db.missions.find((x) => x.id === id);
    if (m) Object.assign(m, p, { updatedAt: Date.now() });
  });
}
async function addStep(id: string, step: Omit<MissionStep, "id" | "ts">) {
  await mutate((db) => {
    const m = db.missions.find((x) => x.id === id);
    if (m) {
      m.steps.push({ ...step, id: uid(), ts: Date.now() });
      m.updatedAt = Date.now();
    }
  });
}
async function pushApi(id: string, msg: MissionApiMsg) {
  await mutate((db) => {
    const m = db.missions.find((x) => x.id === id);
    if (m) {
      m.api.push(msg);
      m.updatedAt = Date.now();
    }
  });
}

export async function createMission(
  objective: string,
  opts: { scheduledFor?: number; recurrence?: { everyMs: number } } = {}
): Promise<Mission> {
  const scheduled = opts.scheduledFor && opts.scheduledFor > Date.now() ? opts.scheduledFor : undefined;
  const m: Mission = {
    id: uid(),
    objective,
    status: "queued",
    steps: [
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
  await mutate((db) => db.missions.unshift(m));
  return m;
}

/** Mark a completed mission as seen — durable, so results are never lost and
 *  "results waiting" is consistent across devices and restarts. */
export async function setMissionAcknowledged(id: string, acknowledged: boolean) {
  await mutate((db) => {
    const m = db.missions.find((x) => x.id === id);
    if (m) {
      m.acknowledged = acknowledged;
      m.updatedAt = Date.now();
    }
  });
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
    try {
      result = await tool.execute(args);
      await addStep(id, {
        kind: "action",
        text: tool.summarize(args),
        detail: result?.ok === false ? String(result.error || "Failed") : undefined,
      });
    } catch (e: any) {
      result = { ok: false, error: e?.message || "Failed" };
      await addStep(id, { kind: "error", text: tool.summarize(args), detail: result.error });
    }
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
  await patch(id, { status: "done", result: report, pending: [] });

  // Recurring missions queue their next run.
  if (m.recurrence?.everyMs) {
    await createMission(m.objective, {
      scheduledFor: Date.now() + m.recurrence.everyMs,
      recurrence: m.recurrence,
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
      if (paused) return; // another approval needed
    }

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const m = await getMission(id);
      if (!m) return;

      const system: MissionApiMsg = { role: "system", content: MISSION_SYSTEM(context) };
      const message = await callModel([system, ...m.api], { tools: true });
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
      if (paused) return; // resumes via approveMission
    }
    await finalize(id, "Reached the mission step limit; reporting partial progress.");
  } catch (e: any) {
    const msg = e?.message || "Mission failed.";
    const m = await getMission(id);
    const attempts = (m?.attempts ?? 0) + 1;
    await addStep(id, { kind: "error", text: msg });
    if (attempts < MAX_ATTEMPTS) {
      // Transient failure → re-queue with backoff. Safe to re-run: the
      // idempotency guard skips any action already completed this mission.
      await addStep(id, { kind: "progress", text: `Auto-retry ${attempts + 1}/${MAX_ATTEMPTS} after failure` });
      await patch(id, {
        status: "queued",
        attempts,
        pending: [],
        scheduledFor: Date.now() + RETRY_DELAY_MS,
      });
    } else {
      await patch(id, { status: "failed", attempts, result: msg });
    }
  }
}

/**
 * Record the user's approval decision and hand the mission back to the worker.
 * Execution never happens here (this may run on the stateless web tier) — the
 * worker picks the re-queued mission up and applies the decision on resume.
 */
export async function cancelMission(id: string) {
  await mutate((db) => {
    const m = db.missions.find((x) => x.id === id);
    if (!m) return;
    m.recurrence = undefined;          // stop any future occurrences
    m.pending = [];
    if (m.status !== "done") {
      m.status = "done";
      m.result = (m.result ? m.result + " " : "") + "(canceled)";
      m.acknowledged = true;
    }
    m.updatedAt = Date.now();
  });
}

export async function approveMission(id: string, approved: boolean) {
  const m = await getMission(id);
  if (!m || m.status !== "needs_approval" || !m.pending.length) return;
  await patch(id, { status: "queued", scheduledFor: undefined, pendingDecision: approved });
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

  const claim = (id: string) => {
    inflight.add(id);
    runMission(id)
      .catch(() => {}) // never let a rejection escape the worker
      .finally(() => inflight.delete(id));
  };

  let lastBeat = 0;
  const tick = async () => {
    try {
      // Throttled liveness beat so /api/health can confirm the runtime is alive.
      if (Date.now() - lastBeat > 15_000) {
        lastBeat = Date.now();
        await setWorkerHeartbeat().catch(() => {});
      }
      const missions = await listMissions();
      // Newly queued work, plus any mission left "running" that isn't currently
      // being worked in this process — i.e. resume immediately after a restart.
      // The inflight set prevents double-running; the idempotency guard makes
      // resuming a half-done turn safe.
      const now = Date.now();
      const candidates = missions.filter(
        (m) =>
          (m.status === "queued" && (!m.scheduledFor || m.scheduledFor <= now)) ||
          m.status === "running"
      );
      for (const m of candidates) {
        if (inflight.size >= MAX_CONCURRENT) break;
        if (inflight.has(m.id)) continue;
        claim(m.id);
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
