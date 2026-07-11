import { read, mutate, uid } from "@/lib/server/db";
import { createMission } from "@/lib/server/missionEngine";
import { logActivity } from "@/lib/server/activity";
import type { MissionTemplate, MissionTemplateStep, Contact } from "@/lib/types";

/**
 * Mission templates (Phase 2 #3) — configurable per brand. When a lead enters a
 * brand's CRM, the brand's active `lead_created` template is instantiated into a
 * staggered set of real missions (brand- and lead-scoped), so the funnel runs
 * itself: onboarding → CRM → automatic mission generation → execution.
 */

/** The seeded default playbooks, keyed by brand name (requirement #3). */
const DEFAULTS: Record<string, string[]> = {
  "Prism44": [
    "Discovery call with {{lead}}: schedule it, prepare an agenda, and capture goals, brand, and deliverables.",
    "Gather assets from {{lead}}: request and organize logos, brand guidelines, references, and inspiration.",
    "Draft a proposal for {{lead}}: scope, deliverables, timeline, and pricing based on the discovery call.",
    "Schedule production for {{lead}}: block the shoot/edit calendar and confirm dates.",
    "Deliver content to {{lead}}: package final assets, share for review, and request feedback.",
  ],
  "Quality Management": [
    "Property intake for {{lead}}: confirm address, units, scope of work, and access details.",
    "Inspection for {{lead}}: schedule and conduct the on-site inspection; document findings with photos.",
    "Generate estimate for {{lead}}: itemize materials + labor and produce a priced estimate.",
    "Schedule crew for {{lead}}: assign the crew and confirm the work window.",
    "Completion review for {{lead}}: final walkthrough, punch list, and sign-off.",
  ],
  "UW Equity": [
    "Investor qualification for {{lead}}: confirm accreditation, capital available, and acquisition criteria.",
    "Underwriting for {{lead}}: model the target(s) against the investor's return thresholds.",
    "Acquisition review for {{lead}}: assess fit vs. market focus and shortlist opportunities.",
    "Due diligence for {{lead}}: coordinate documents, title, and financials review.",
    "Closing for {{lead}}: prepare the closing checklist and coordinate signatures.",
  ],
};

function mkSteps(objectives: string[]): MissionTemplateStep[] {
  return objectives.map((objective, i) => ({ id: uid(), objective, order: i, offsetMinutes: i * 30 }));
}

/** Idempotently seed the default template for any known brand that has none. */
export async function ensureTemplatesSeeded(): Promise<void> {
  const brands = await read((db) => (db.brands || []).map((b) => ({ id: b.id, name: b.name })));
  const existing = await read((db) => new Set((db.missionTemplates || []).map((t) => t.brandId)));
  const toAdd: MissionTemplate[] = [];
  const now = Date.now();
  for (const b of brands) {
    if (existing.has(b.id)) continue;
    const objectives = DEFAULTS[b.name];
    if (!objectives) continue;
    toAdd.push({
      id: uid(), brandId: b.id, name: `${b.name} — Lead playbook`,
      trigger: "lead_created", steps: mkSteps(objectives), status: "active",
      createdAt: now, updatedAt: now,
    });
  }
  if (toAdd.length) await mutate((db) => { db.missionTemplates = [...(db.missionTemplates || []), ...toAdd]; });
}

/* ---- CRUD ---- */
export async function listTemplates(brandId?: string): Promise<MissionTemplate[]> {
  await ensureTemplatesSeeded();
  return read((db) => (db.missionTemplates || []).filter((t) => !brandId || t.brandId === brandId));
}
export async function getTemplate(id: string): Promise<MissionTemplate | undefined> {
  return read((db) => (db.missionTemplates || []).find((t) => t.id === id));
}
export async function createTemplate(input: Partial<MissionTemplate>): Promise<MissionTemplate> {
  const now = Date.now();
  const t: MissionTemplate = {
    id: uid(),
    brandId: String(input.brandId || ""),
    name: String(input.name || "Untitled template").slice(0, 160),
    trigger: input.trigger === "manual" ? "manual" : "lead_created",
    steps: normalizeSteps(input.steps),
    status: input.status === "disabled" ? "disabled" : "active",
    createdAt: now, updatedAt: now,
  };
  await mutate((db) => { db.missionTemplates = [...(db.missionTemplates || []), t]; });
  return t;
}
export async function patchTemplate(id: string, input: Partial<MissionTemplate>): Promise<MissionTemplate | undefined> {
  let out: MissionTemplate | undefined;
  await mutate((db) => {
    const t = (db.missionTemplates || []).find((x) => x.id === id);
    if (!t) return;
    if (input.name != null) t.name = String(input.name).slice(0, 160);
    if (input.trigger) t.trigger = input.trigger === "manual" ? "manual" : "lead_created";
    if (input.status) t.status = input.status === "disabled" ? "disabled" : "active";
    if (input.steps) t.steps = normalizeSteps(input.steps);
    t.updatedAt = Date.now();
    out = t;
  });
  return out;
}
export async function deleteTemplate(id: string): Promise<boolean> {
  let ok = false;
  await mutate((db) => {
    const before = (db.missionTemplates || []).length;
    db.missionTemplates = (db.missionTemplates || []).filter((t) => t.id !== id);
    ok = (db.missionTemplates || []).length < before;
  });
  return ok;
}

function normalizeSteps(steps: any): MissionTemplateStep[] {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 30).map((s: any, i: number) => ({
    id: s?.id ? String(s.id) : uid(),
    objective: String(s?.objective || "").slice(0, 500),
    order: Number.isFinite(s?.order) ? s.order : i,
    offsetMinutes: Number.isFinite(s?.offsetMinutes) ? Math.max(0, s.offsetMinutes) : i * 30,
  })).filter((s) => s.objective.length > 2);
}

/**
 * Instantiate a brand's active lead-intake template(s) into real missions for a
 * new lead. Returns the created mission ids (also attached to the contact).
 */
export async function instantiateForLead(brandId: string, contact: Pick<Contact, "id" | "name">): Promise<string[]> {
  await ensureTemplatesSeeded();
  const templates = await read((db) =>
    (db.missionTemplates || []).filter((t) => t.brandId === brandId && t.status === "active" && t.trigger === "lead_created")
  );
  const brand = await read((db) => (db.brands || []).find((b) => b.id === brandId));
  const leadName = contact.name || "the lead";
  const ids: string[] = [];
  for (const t of templates) {
    for (const step of [...t.steps].sort((a, b) => a.order - b.order)) {
      const objective = step.objective
        .replace(/\{\{\s*lead\s*\}\}/gi, leadName)
        .replace(/\{\{\s*brand\s*\}\}/gi, brand?.name || "the brand");
      const m = await createMission(objective, {
        brandId, contactId: contact.id, priority: 3,
        scheduledFor: step.offsetMinutes ? Date.now() + step.offsetMinutes * 60_000 : undefined,
      });
      ids.push(m.id);
    }
  }
  if (ids.length) {
    await logActivity({ brandId, kind: "mission_created", title: `${ids.length} missions auto-generated for ${leadName}`, detail: brand?.name, refType: "contact", refId: contact.id });
  }
  return ids;
}
