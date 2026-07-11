import { read, mutate } from "@/lib/server/db";
import { instantiateForLead } from "@/lib/server/missionTemplates";
import { logActivity } from "@/lib/server/activity";

/**
 * Lead intake orchestration (Phase 2 #3) — the bridge from "a lead entered the
 * CRM" to "the OS is already working on it". Given a freshly-created contact, it
 * places the lead at the first pipeline stage, instantiates the brand's mission
 * template, attaches those missions to the lead, and logs the new-lead activity.
 * Idempotent: a lead that already has attached missions is not re-instantiated.
 */
export async function runLeadIntake(contactId: string): Promise<{ ok: boolean; missionIds: string[]; already?: boolean }> {
  const contact = await read((db) => (db.contacts || []).find((c) => c.id === contactId));
  if (!contact) return { ok: false, missionIds: [] };
  if (contact.attachedMissionIds && contact.attachedMissionIds.length) {
    return { ok: true, missionIds: contact.attachedMissionIds, already: true };
  }

  const brandId = contact.brandId || null;
  const brand = brandId ? await read((db) => (db.brands || []).find((b) => b.id === brandId)) : null;
  const firstStage = brand?.pipelineStages?.[0]?.key || "new_lead";

  const missionIds = brandId ? await instantiateForLead(brandId, { id: contact.id, name: contact.name }) : [];

  await mutate((db) => {
    const c = (db.contacts || []).find((x) => x.id === contactId);
    if (!c) return;
    c.attachedMissionIds = missionIds;
    if (!c.pipelineStage) c.pipelineStage = firstStage;
    if (!c.lastContact) c.lastContact = Date.now();
  });

  await logActivity({
    brandId,
    kind: "new_lead",
    title: `New lead: ${contact.name}`,
    detail: `source ${contact.leadSource || "unknown"}${contact.campaign ? ` · ${contact.campaign}` : ""}`,
    refType: "contact",
    refId: contact.id,
  });

  return { ok: true, missionIds };
}
