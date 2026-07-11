"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useBrand } from "@/components/BrandContext";
import { uid, type MissionTemplate, type MissionTemplateStep } from "@/lib/store";

/**
 * Mission template editor (Phase 2 #3). Each brand's lead-intake playbook — the
 * ordered missions auto-generated when a lead enters the CRM. Configurable per
 * brand. Functional, minimal UI.
 */
export default function TemplatesPage() {
  const { activeBrand, isParentActive } = useBrand();
  const brandId = activeBrand?.id;
  const [templates, setTemplates] = useState<MissionTemplate[]>([]);

  const load = useCallback(() => {
    if (!brandId) return;
    fetch(`/api/mission-templates?brandId=${brandId}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setTemplates(d.templates || []));
  }, [brandId]);
  useEffect(() => { load(); }, [load]);

  async function createTemplate() {
    await fetch("/api/mission-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandId, name: `${activeBrand?.name} — Playbook`, trigger: "lead_created", steps: [] }) });
    load();
  }
  async function save(t: MissionTemplate) {
    setTemplates((prev) => prev.map((x) => (x.id === t.id ? t : x)));
    await fetch(`/api/mission-templates/${t.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: t.name, status: t.status, steps: t.steps }) });
  }
  async function del(id: string) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/mission-templates/${id}`, { method: "DELETE" });
    load();
  }

  if (isParentActive) return <Wrap><div className="glass p-8 text-slate-400">Select a subsidiary brand in the switcher to edit its mission templates.</div></Wrap>;

  return (
    <Wrap>
      <div className="mb-4"><button onClick={createTemplate} className="btn-primary text-sm">+ New template</button></div>
      {templates.length === 0 && <div className="glass p-8 text-slate-500">No templates yet.</div>}
      <div className="space-y-4">
        {templates.map((t) => (
          <div key={t.id} className="glass p-4">
            <div className="flex items-center gap-2 mb-3">
              <input className="input flex-1" value={t.name} onChange={(e) => save({ ...t, name: e.target.value })} />
              <button onClick={() => save({ ...t, status: t.status === "active" ? "disabled" : "active" })} className={`text-xs px-2 py-1 rounded-full border ${t.status === "active" ? "border-emerald-500/40 text-emerald-300" : "border-white/10 text-slate-500"}`}>{t.status}</button>
              <button onClick={() => del(t.id)} className="text-pink-400/70 hover:text-pink-400 text-sm">✕</button>
            </div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Trigger: {t.trigger} · runs when a lead enters this brand's CRM</div>
            <div className="space-y-2">
              {[...t.steps].sort((a, b) => a.order - b.order).map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-5">{i + 1}.</span>
                  <input className="input flex-1 text-sm" value={s.objective} onChange={(e) => save({ ...t, steps: t.steps.map((x) => (x.id === s.id ? { ...x, objective: e.target.value } : x)) })} />
                  <button onClick={() => save({ ...t, steps: t.steps.filter((x) => x.id !== s.id) })} className="text-pink-400/60 hover:text-pink-400 text-sm px-1">✕</button>
                </div>
              ))}
            </div>
            <button
              onClick={() => save({ ...t, steps: [...t.steps, { id: uid(), objective: "New mission for {{lead}}", order: t.steps.length, offsetMinutes: t.steps.length * 30 } as MissionTemplateStep] })}
              className="text-sm text-accent hover:underline mt-2"
            >+ Add step</button>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-600 mt-4">Tokens: <code>{"{{lead}}"}</code> = lead name, <code>{"{{brand}}"}</code> = brand name.</p>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="max-w-3xl mx-auto pb-16"><PageHeader title="Mission Templates" subtitle="Per-brand playbooks — auto-run when a lead enters the CRM" />{children}</div>;
}
