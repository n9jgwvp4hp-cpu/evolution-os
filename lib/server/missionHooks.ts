import { read, mutate } from "@/lib/server/db";
import { logActivity } from "@/lib/server/activity";
import { raiseApproval, classifyApproval } from "@/lib/server/approvals";
import type { Mission } from "@/lib/missionTypes";

/**
 * Mission lifecycle → operational systems bridge (Phase 2).
 *
 * When a mission completes/fails or pauses for approval, this feeds the global
 * activity feed, advances the linked CRM lead through the brand pipeline, and
 * raises approvals. Imported dynamically by the mission engine so the engine
 * stays decoupled from the operational layer.
 */

/** Advance the lead one pipeline stage (capped at the last), and log the move. */
async function advanceLead(brandId: string | null, contactId: string, missionObjective: string) {
  let moved: { from?: string; to?: string; name?: string } = {};
  await mutate((db) => {
    const c = (db.contacts || []).find((x) => x.id === contactId);
    if (!c) return;
    c.lastContact = Date.now();
    const brand = (db.brands || []).find((b) => b.id === (brandId ?? c.brandId));
    const stages = brand?.pipelineStages || [];
    if (stages.length) {
      const idx = Math.max(0, stages.findIndex((s) => s.key === c.pipelineStage));
      const next = stages[Math.min(idx + 1, stages.length - 1)];
      if (next && next.key !== c.pipelineStage) { moved = { from: c.pipelineStage, to: next.label, name: c.name }; c.pipelineStage = next.key; }
    }
    c.nextAction = `Continue: ${missionObjective.slice(0, 80)}`;
  });
  if (moved.to) {
    await logActivity({ brandId, kind: "pipeline_update", title: `${moved.name} → ${moved.to}`, detail: "pipeline advanced on mission completion", refType: "contact", refId: contactId });
  }
}

export async function onMissionCompleted(m: Mission) {
  await logActivity({ brandId: m.brandId ?? null, kind: "mission_completed", title: `Completed: ${String(m.objective).slice(0, 100)}`, refType: "mission", refId: m.id });
  if (m.contactId) await advanceLead(m.brandId ?? null, m.contactId, m.objective);
}

export async function onMissionFailed(m: Mission) {
  await logActivity({ brandId: m.brandId ?? null, kind: "mission_failed", title: `Failed: ${String(m.objective).slice(0, 100)}`, refType: "mission", refId: m.id });
  await logActivity({ brandId: m.brandId ?? null, kind: "blocker", title: `Blocked: ${String(m.objective).slice(0, 100)}`, detail: "mission failed — needs attention", refType: "mission", refId: m.id });
}

/** A mission paused for approval. Classify why (money/contract/external meeting/…)
 *  and raise it into the approval queue so it surfaces in one inbox. */
export async function onMissionNeedsApproval(m: Mission, summary: string) {
  // Try to classify from the pending tool call; default to "other" so it is still surfaced.
  const call = m.pending?.[0]?.call;
  const actionType = call?.function?.name || "action";
  let payload: any = {};
  try { payload = JSON.parse(call?.function?.arguments || "{}"); } catch {}
  const reason = classifyApproval(actionType, payload) || "other";
  await raiseApproval({
    brandId: m.brandId ?? null,
    reason,
    title: summary || `Approve: ${String(m.objective).slice(0, 80)}`,
    detail: `Mission is waiting on: ${actionType}`,
    action: { type: actionType, payload },
    missionId: m.id,
  });
}
