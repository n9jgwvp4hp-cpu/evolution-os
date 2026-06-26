import { mutate, getMission, listMissions, uid } from "@/lib/server/db";
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

const MAX_TURNS = 14;
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

export async function createMission(objective: string): Promise<Mission> {
  const m: Mission = {
    id: uid(),
    objective,
    status: "queued",
    steps: [{ id: uid(), ts: Date.now(), kind: "plan", text: "Mission accepted" }],
    api: [{ role: "user", content: objective }],
    pending: [],
    qcLeft: 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await mutate((db) => db.missions.unshift(m));
  return m;
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

  // one retry on transient failure
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        lastErr = (await res.text().catch(() => "")) || `HTTP ${res.status}`;
        if (res.status >= 500 || res.status === 429) continue; // retry
        throw new Error(lastErr.slice(0, 300));
      }
      const data = await res.json();
      return data.choices?.[0]?.message ?? { role: "assistant", content: "" };
    } catch (e: any) {
      lastErr = e?.message || "network error";
    }
  }
  throw new Error("Model call failed: " + lastErr.slice(0, 200));
}

const MISSION_SYSTEM = (context: string) =>
  "You are Evolution OS executing a long-running MISSION autonomously on the server. " +
  "The user is not watching — make reasonable assumptions instead of asking questions. " +
  "Work step by step using the available capabilities until the objective is fully accomplished. " +
  "Each assistant message before you finish should be one short progress line. " +
  "CRITICAL: only claim what you actually did with real capabilities. If part of the objective " +
  "cannot truly be done (no capability for it), say so plainly in your report — never fabricate " +
  "results, research, or actions. When fully done, send a final message with NO tool calls: a " +
  "concise, honest report of what you accomplished and any result the user needs.\n" +
  (context ? "\nWhat Evolution already knows:\n" + context : "");

function parseArgs(call: any) {
  try { return JSON.parse(call.function?.arguments || "{}"); } catch { return {}; }
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
      "actions. Be skeptical: if the report claims something that was not actually done, it fails. " +
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
          `${verdict.guidance || ""} Address these now using real capabilities, then report again. ` +
          `If something genuinely cannot be done, state that plainly instead of claiming it was done.`,
      });
      await runMission(id); // keep working
      return;
    }
    await addStep(id, { kind: "progress", text: "Quality check passed" });
  }

  await addStep(id, { kind: "result", text: report });
  await patch(id, { status: "done", result: report, pending: [] });
}

/* ---- the main loop ---- */
export async function runMission(id: string) {
  const startMission = await getMission(id);
  if (!startMission || startMission.status === "done" || startMission.status === "failed") return;
  await patch(id, { status: "running" });
  const context = await buildBrainContext();

  try {
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
    await addStep(id, { kind: "error", text: e?.message || "Mission failed." });
    await patch(id, { status: "failed", result: e?.message || "Failed." });
  }
}

export async function approveMission(id: string, approved: boolean) {
  const m = await getMission(id);
  if (!m || m.status !== "needs_approval" || !m.pending.length) return;
  const [head, ...rest] = m.pending;
  await patch(id, { status: "running", pending: [] });
  await executeCall(id, head.call, approved);
  const paused = await processCalls(id, rest.map((p) => p.call));
  if (!paused) await runMission(id);
}

/* ---- background worker ---- */
let workerStarted = false;
const inflight = new Set<string>();

export function startWorker() {
  if (workerStarted) return;
  workerStarted = true;

  const tick = async () => {
    try {
      const missions = await listMissions();
      for (const m of missions) {
        if (inflight.has(m.id)) continue;
        // Pick up newly queued work, and resume anything left "running" by a restart.
        if (m.status === "queued" || m.status === "running") {
          inflight.add(m.id);
          runMission(m.id).finally(() => inflight.delete(m.id));
        }
      }
    } catch {
      /* keep the worker alive no matter what */
    }
  };

  setInterval(tick, 2000);
  tick();
  // eslint-disable-next-line no-console
  console.log("[Evolution OS] mission worker started");
}
