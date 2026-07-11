"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useBrand } from "@/components/BrandContext";
import { DEFAULT_PIPELINE_STAGES, type Contact, type PipelineStage } from "@/lib/types";

/**
 * Brand CRM pipeline (Phase 2 #2) — leads on the active brand's editable stages.
 * Move a lead between stages, see owner / source / revenue / next action /
 * attached missions, and run intake (auto-generate the brand's missions).
 * Minimal kanban UI.
 */
export default function LeadsPage() {
  const { activeBrand, isParentActive } = useBrand();
  const [leads, setLeads] = useState<Contact[]>([]);

  const stages: PipelineStage[] = activeBrand?.pipelineStages?.length ? activeBrand.pipelineStages : DEFAULT_PIPELINE_STAGES;

  const load = useCallback(() => {
    const q = activeBrand && !isParentActive ? `?brandId=${activeBrand.id}` : "";
    fetch(`/api/data/contacts${q}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setLeads(d.items || [])).catch(() => {});
  }, [activeBrand, isParentActive]);
  useEffect(() => { load(); }, [load]);

  const byStage = useMemo(() => {
    const map: Record<string, Contact[]> = {};
    for (const s of stages) map[s.key] = [];
    const firstKey = stages[0]?.key || "new_lead";
    for (const l of leads) { const k = l.pipelineStage && map[l.pipelineStage] ? l.pipelineStage : firstKey; (map[k] ||= []).push(l); }
    return map;
  }, [leads, stages]);

  async function move(lead: Contact, stageKey: string, label: string) {
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, pipelineStage: stageKey } : l)));
    await fetch(`/api/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pipelineStage: stageKey, __stageLabel: label }) }).catch(() => {});
  }
  async function intake(lead: Contact) {
    await fetch(`/api/leads/intake`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contactId: lead.id }) }).catch(() => {});
    load();
  }

  return (
    <div className="max-w-[1500px] mx-auto pb-16">
      <PageHeader title="Lead Pipeline" subtitle={`${activeBrand && !isParentActive ? activeBrand.name : "Portfolio"} · ${leads.length} leads`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {stages.map((stage, si) => {
          const items = byStage[stage.key] || [];
          return (
            <div key={stage.key} className="glass p-3">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">{stage.label}</span>
                <span className="text-xs text-slate-500">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((l) => (
                  <div key={l.id} className="rounded-lg border border-white/10 bg-white/5 p-2.5">
                    <div className="text-sm text-slate-100 truncate">{l.name}</div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                      {l.leadSource && <span>src: {l.leadSource}</span>}
                      {l.campaign && <span>· {l.campaign}</span>}
                      {l.owner && <span>· {l.owner}</span>}
                    </div>
                    {l.nextAction && <div className="text-[11px] text-cyan-300/80 mt-1 truncate">→ {l.nextAction}</div>}
                    <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2">
                      {typeof l.revenue === "number" && l.revenue > 0 && <span className="text-emerald-300">${l.revenue.toLocaleString()}</span>}
                      {l.attachedMissionIds?.length ? <span>🚀 {l.attachedMissionIds.length}</span> : <button onClick={() => intake(l)} className="text-accent hover:underline">Run intake</button>}
                    </div>
                    <div className="flex gap-1 mt-2">
                      {si > 0 && <button onClick={() => move(l, stages[si - 1].key, stages[si - 1].label)} className="text-[11px] px-1.5 py-0.5 rounded border border-white/10 text-slate-400 hover:bg-white/5">←</button>}
                      {si < stages.length - 1 && <button onClick={() => move(l, stages[si + 1].key, stages[si + 1].label)} className="text-[11px] px-1.5 py-0.5 rounded border border-white/10 text-slate-400 hover:bg-white/5 ml-auto">→</button>}
                    </div>
                  </div>
                ))}
                {items.length === 0 && <div className="text-[11px] text-slate-600 text-center py-4">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
