"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useBrand } from "@/components/BrandContext";

/**
 * Objectives — the top of the autonomous system. You state outcomes ("Grow
 * Prism44"); Evolution OS continuously generates, prioritizes, and works the
 * missions that move each one forward. Creating an objective plans it immediately.
 * Scoped to the active brand (Personal/Portfolio sees all). Minimal UI.
 */
type Obj = {
  id: string; brandId: string | null; title: string; description: string;
  metric?: string; target?: string; current?: string; status: string;
  priority: number; state: string; progress: number;
  missions: { total: number; inProgress: number; queued: number; blocked: number; waitingApproval: number; done: number };
};

export default function ObjectivesPage() {
  const { brands, activeBrand, isParentActive } = useBrand();
  const [objectives, setObjectives] = useState<Obj[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", metric: "", target: "", brandId: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const brandName = (id: string | null) => brands.find((b) => b.id === id)?.name || "Unassigned";
  const brandColor = (id: string | null) => brands.find((b) => b.id === id)?.colors?.primary || "#6366f1";

  const load = useCallback(() => {
    fetch("/api/objectives", { cache: "no-store" }).then((r) => r.json()).then((d) => setObjectives(d.objectives || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);

  const personalId = brands.find((b) => b.kind === "personal")?.id;
  const visible = useMemo(() => {
    // Business-focused: hide the personal account's objectives unless it's active.
    let list = objectives;
    if (activeBrand && !isParentActive) list = list.filter((o) => o.brandId === activeBrand.id);
    else if (activeBrand?.kind !== "personal") list = list.filter((o) => o.brandId !== personalId);
    return list;
  }, [objectives, activeBrand, isParentActive, personalId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setCreating(false);
    const brandId = form.brandId || (activeBrand && !isParentActive ? activeBrand.id : "");
    await fetch("/api/objectives", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, brandId: brandId || null }),
    });
    setForm({ title: "", description: "", metric: "", target: "", brandId: "" });
    load();
  }

  async function planNow(id: string) {
    setBusy(id);
    await fetch(`/api/objectives/${id}/plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) }).catch(() => {});
    setBusy(null);
    load();
  }

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <PageHeader
        title="Objectives"
        subtitle="State an outcome — the OS generates and works the missions"
        action={<button className="btn-primary" onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "+ New objective"}</button>}
      />

      {creating && (
        <form onSubmit={create} className="glass p-4 mb-6 grid gap-3">
          <input className="input" placeholder="Objective (e.g. Grow Prism44)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid sm:grid-cols-3 gap-3">
            <input className="input" placeholder="Metric (e.g. leads)" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} />
            <input className="input" placeholder="Target (e.g. 20)" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
            <select className="input" value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
              <option value="">{activeBrand && !isParentActive ? activeBrand.name : "Choose brand"}</option>
              {brands.filter((b) => b.kind !== "personal").map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><button className="btn-primary" type="submit">Create + generate missions</button></div>
        </form>
      )}

      {visible.length === 0 ? (
        <div className="glass p-10 text-center text-slate-500">No objectives yet. Create one and the OS will start working it.</div>
      ) : (
        <div className="space-y-4">
          {visible.sort((a, b) => b.priority - a.priority).map((o) => (
            <div key={o.id} className="glass p-5">
              <div className="flex items-center gap-2.5">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: brandColor(o.brandId) }} />
                <h3 className="font-semibold text-white">{o.title}</h3>
                <span className="text-[11px] text-slate-500">{brandName(o.brandId)}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${o.status === "active" ? "bg-emerald-500/15 text-emerald-300" : o.status === "done" ? "bg-slate-500/15 text-slate-300" : "bg-amber-500/15 text-amber-300"}`}>{o.status}</span>
                <span className="ml-auto text-xs text-slate-500">P{o.priority}</span>
              </div>

              {/* progress */}
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${o.progress}%` }} />
                </div>
                <span className="text-xs text-slate-400 w-10 text-right">{o.progress}%</span>
              </div>
              {o.metric && <div className="text-[11px] text-slate-500 mt-1">{o.metric}: {o.current || "0"}{o.target ? ` / ${o.target}` : ""}</div>}

              {o.state && o.state !== "new" && <p className="text-sm text-slate-400 mt-2">{o.state}</p>}

              {/* mission rollup */}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                <Pill label="in progress" n={o.missions.inProgress} cls="text-sky-300" />
                <Pill label="queued" n={o.missions.queued} cls="text-slate-300" />
                <Pill label="blocked" n={o.missions.blocked} cls="text-amber-300" />
                <Pill label="approval" n={o.missions.waitingApproval} cls="text-violet-300" />
                <Pill label="done" n={o.missions.done} cls="text-emerald-300" />
                <button onClick={() => planNow(o.id)} disabled={busy === o.id} className="ml-auto text-xs text-accent hover:underline disabled:opacity-50">
                  {busy === o.id ? "Planning…" : "Re-plan now"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full border border-white/10 bg-white/5 ${n ? cls : "text-slate-600"}`}>
      {n} {label}
    </span>
  );
}
