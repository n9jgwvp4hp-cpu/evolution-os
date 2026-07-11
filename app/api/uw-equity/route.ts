import { NextResponse } from "next/server";
import { read } from "@/lib/server/db";
import { listBrands } from "@/lib/server/brands";
import { listMissionViews } from "@/lib/server/missionStore";
import { startWorker } from "@/lib/server/missionEngine";
import type { Contact, Deal, Project, Objective, LeadSource } from "@/lib/types";
import { LEAD_SOURCES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/uw-equity — the parent-company portfolio dashboard.
 *
 * Aggregates, per brand and rolled up across the portfolio: active missions,
 * leads (with lead-source breakdown), revenue (closed + pipeline + commission),
 * projects, and blockers (failed / approval-gated missions + stalled objectives).
 * Missions ladder to objectives, objectives carry a brandId — so a mission's
 * brand is resolved through its objective.
 */

const OPEN_MISSION = new Set(["queued", "running", "needs_approval"]);
const CLOSED_DEAL = new Set(["closed"]);
const DEAD_DEAL = new Set(["closed", "lost"]);

type Blocker = { type: string; label: string; detail?: string };

export async function GET() {
  startWorker();
  const now = Date.now();

  const [brands, missions, brain] = await Promise.all([
    listBrands(),
    listMissionViews(),
    read((db) => ({
      contacts: db.contacts || [],
      deals: db.deals || [],
      projects: db.projects || [],
      objectives: db.objectives || [],
    })),
  ]);

  const parent = brands.find((b) => b.isParent) || null;
  // objectiveId → brandId, so a mission can be attributed to a brand via its objective.
  const objBrand = new Map<string, string | null>(brain.objectives.map((o: Objective) => [o.id, o.brandId ?? null]));

  const emptySources = (): Record<LeadSource, number> =>
    LEAD_SOURCES.reduce((o, s) => ((o[s] = 0), o), {} as Record<LeadSource, number>);

  function aggregateBrand(brandId: string) {
    const contacts = brain.contacts.filter((c: Contact) => c.brandId === brandId);
    const deals = brain.deals.filter((d: Deal) => d.brandId === brandId);
    const projects = brain.projects.filter((p: Project) => p.brandId === brandId);
    const objectives = brain.objectives.filter((o: Objective) => o.brandId === brandId);
    const brandMissions = missions.filter((m) => m.objectiveId && objBrand.get(m.objectiveId) === brandId);

    const bySource = emptySources();
    for (const c of contacts) {
      const s = (c.leadSource || "other") as LeadSource;
      if (s in bySource) bySource[s]++; else bySource.other++;
    }

    const closed = deals.filter((d) => CLOSED_DEAL.has(d.stage));
    const openDeals = deals.filter((d) => !DEAD_DEAL.has(d.stage));
    const revenue = {
      closed: closed.reduce((s, d) => s + (d.price || 0), 0),
      pipeline: openDeals.reduce((s, d) => s + (d.price || 0), 0),
      commission: closed.reduce((s, d) => s + (d.commission || 0), 0),
      dealsClosed: closed.length,
      dealsOpen: openDeals.length,
    };

    const mc = { total: brandMissions.length, active: 0, queued: 0, running: 0, needsApproval: 0, done: 0, failed: 0 };
    for (const m of brandMissions) {
      if (m.status === "queued") mc.queued++;
      else if (m.status === "running") mc.running++;
      else if (m.status === "needs_approval") mc.needsApproval++;
      else if (m.status === "done") mc.done++;
      else if (m.status === "failed") mc.failed++;
      if (OPEN_MISSION.has(m.status)) mc.active++;
    }

    const activeObjectives = objectives.filter((o) => o.status === "active");
    const avgProgress = activeObjectives.length
      ? Math.round(activeObjectives.reduce((s, o) => s + (o.progress || 0), 0) / activeObjectives.length)
      : 0;

    // Blockers: failed missions, decisions awaiting the user, and stalled objectives.
    const blockers: Blocker[] = [];
    for (const m of brandMissions.filter((m) => m.status === "failed").slice(0, 10))
      blockers.push({ type: "mission_failed", label: `Mission failed: ${String(m.objective).slice(0, 80)}`, detail: m.id });
    for (const m of brandMissions.filter((m) => m.status === "needs_approval").slice(0, 10))
      blockers.push({ type: "needs_approval", label: `Awaiting your approval: ${String(m.objective).slice(0, 80)}`, detail: m.id });
    for (const o of activeObjectives) {
      const openForObj = brandMissions.filter((m) => m.objectiveId === o.id && OPEN_MISSION.has(m.status)).length;
      if (openForObj === 0 && (o.progress || 0) === 0)
        blockers.push({ type: "objective_stalled", label: `Objective not progressing: ${o.title}`, detail: "no active missions" });
    }

    return {
      leads: { total: contacts.length, bySource, byStatus: countBy(contacts, (c) => c.status) },
      revenue,
      missions: mc,
      objectives: { total: objectives.length, active: activeObjectives.length, avgProgress },
      projects: { total: projects.length, active: projects.filter((p) => p.status === "active").length },
      blockers,
    };
  }

  // The portfolio is BUSINESS only — the Personal account is never included.
  const businessBrands = brands.filter((b) => b.kind !== "personal");
  const perBrand = businessBrands.map((b) => ({
    id: b.id, name: b.name, slug: b.slug, isParent: b.isParent, kind: b.kind, status: b.status,
    colors: b.colors, services: b.services, domain: b.domain,
    ...aggregateBrand(b.id),
  }));

  // Portfolio roll-up across the subsidiaries (business brands UW Equity owns).
  const subs = perBrand.filter((b) => b.kind === "brand");
  const portfolioSources = emptySources();
  for (const b of subs) for (const s of LEAD_SOURCES) portfolioSources[s] += b.leads.bySource[s] || 0;
  const portfolio = {
    brands: subs.length,
    leads: subs.reduce((s, b) => s + b.leads.total, 0),
    leadsBySource: portfolioSources,
    revenue: {
      closed: subs.reduce((s, b) => s + b.revenue.closed, 0),
      pipeline: subs.reduce((s, b) => s + b.revenue.pipeline, 0),
      commission: subs.reduce((s, b) => s + b.revenue.commission, 0),
    },
    activeMissions: subs.reduce((s, b) => s + b.missions.active, 0),
    projects: { total: subs.reduce((s, b) => s + b.projects.total, 0), active: subs.reduce((s, b) => s + b.projects.active, 0) },
    objectives: { active: subs.reduce((s, b) => s + b.objectives.active, 0) },
    blockers: subs.reduce((s, b) => s + b.blockers.length, 0),
  };

  return NextResponse.json({
    ok: true,
    time: now,
    parent: parent ? { id: parent.id, name: parent.name, colors: parent.colors } : null,
    portfolio,
    brands: perBrand,
  });
}

function countBy<T>(arr: T[], key: (x: T) => string): Record<string, number> {
  const o: Record<string, number> = {};
  for (const x of arr) { const k = key(x); o[k] = (o[k] || 0) + 1; }
  return o;
}
