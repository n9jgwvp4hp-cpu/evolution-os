"use client";

import {
  getMission,
  updateMission,
  addStep,
  pushApi,
  type MissionApiMsg,
} from "@/lib/missions";
import { getTool, toolSchemas } from "@/lib/tools";
import { buildAssistantContext } from "@/lib/context";

/**
 * Drives a Mission to completion in the background.
 *
 * Runs the same tool-aware agent loop as Conversation Mode, but autonomously:
 * it plans, executes capabilities step by step, records progress, pauses for
 * approval on sensitive actions, and finishes with a concise result. State
 * lives in the mission store so a mission survives reloads and can resume.
 */

const MAX_TURNS = 12;

async function callAgent(api: MissionApiMsg[]) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = (typeof window !== "undefined" && localStorage.getItem("evo.openaiKey")) || "";
  const model = (typeof window !== "undefined" && localStorage.getItem("evo.model")) || "";
  if (key) headers["x-openai-key"] = key;

  const res = await fetch("/api/agent", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: api,
      tools: toolSchemas(["start_mission"]), // missions don't spawn missions
      context: buildAssistantContext(),
      model: model || undefined,
      mode: "mission",
    }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `Request failed (${res.status}).`);
  }
  const { message } = await res.json();
  return message;
}

function parseArgs(call: any) {
  try { return JSON.parse(call.function?.arguments || "{}"); } catch { return {}; }
}

/** Execute one tool call (respecting an approval decision) and record it. */
async function executeAndRecord(id: string, call: any, approved: boolean) {
  const name = call.function?.name as string;
  const args = parseArgs(call);
  const tool = getTool(name);
  let result: any;

  if (!approved) {
    result = { ok: false, declined: true };
    addStep(id, { kind: "action", text: `Declined: ${tool?.summarize(args) || name}` });
  } else if (!tool) {
    result = { ok: false, error: "Unknown capability." };
  } else {
    try {
      result = await tool.execute(args);
      addStep(id, {
        kind: "action",
        text: tool.summarize(args),
        detail: result?.ok === false ? String(result.error || "Failed") : undefined,
      });
    } catch (e: any) {
      result = { ok: false, error: e?.message || "Failed" };
      addStep(id, { kind: "error", text: tool.summarize(args), detail: result.error });
    }
  }
  pushApi(id, { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
}

/**
 * Process a turn's tool calls. Returns true if the mission paused for approval
 * (the remaining calls are queued in mission.pending).
 */
async function processCalls(id: string, calls: any[]): Promise<boolean> {
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const tool = getTool(call.function?.name);
    if (tool?.requiresApproval) {
      const pending = calls.slice(i).map((c) => ({
        call: c,
        summary: getTool(c.function?.name)?.summarize(parseArgs(c)) || c.function?.name,
      }));
      updateMission(id, { status: "needs_approval", pending });
      addStep(id, { kind: "progress", text: "Waiting for your approval", detail: tool.summarize(parseArgs(call)) });
      return true;
    }
    await executeAndRecord(id, call, true);
  }
  return false;
}

export async function runMission(id: string) {
  const start = getMission(id);
  if (!start || start.status === "done" || start.status === "failed") return;
  updateMission(id, { status: "running" });

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const m = getMission(id);
      if (!m) return;

      const message = await callAgent(m.api);
      const calls: any[] = message.tool_calls || [];
      pushApi(id, {
        role: "assistant",
        content: message.content ?? "",
        tool_calls: calls.length ? calls : undefined,
      });
      if (message.content && message.content.trim()) {
        addStep(id, { kind: calls.length ? "progress" : "result", text: message.content.trim() });
      }

      if (!calls.length) {
        updateMission(id, { status: "done", result: message.content?.trim() || "Completed." });
        return;
      }

      const paused = await processCalls(id, calls);
      if (paused) return; // resume happens from resolveMissionApproval
    }
    updateMission(id, { status: "done", result: "Reached the mission step limit." });
  } catch (e: any) {
    addStep(id, { kind: "error", text: e?.message || "Mission failed." });
    updateMission(id, { status: "failed", result: e?.message || "Failed." });
  }
}

/** User answered an approval prompt on a paused mission. */
export async function resolveMissionApproval(id: string, approved: boolean) {
  const m = getMission(id);
  if (!m || m.status !== "needs_approval" || !m.pending.length) return;

  const [head, ...rest] = m.pending;
  updateMission(id, { status: "running", pending: [] });

  await executeAndRecord(id, head.call, approved);
  const paused = await processCalls(id, rest.map((p) => p.call));
  if (paused) return;
  await runMission(id); // continue the loop
}

/** On app load, resume any mission that was mid-flight when the tab closed. */
export function resumeInterruptedMissions(list: { id: string; status: string }[]) {
  for (const m of list) {
    if (m.status === "running") runMission(m.id);
  }
}
