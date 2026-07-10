"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { formatMoney } from "@/lib/store";

/**
 * UW Equity portfolio dashboard (functional, minimal UI — polish comes later).
 * Rolls up every subsidiary: active missions, leads (+ source mix), revenue,
 * projects, and blockers, plus a per-brand breakdown.
 */
type Dash = any;

export default function UWEquityPage() {
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/uw-equity", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => { if (alive) { d.ok ? setData(d) : setErr("Failed to load"); } })
        .catch(() => alive && setErr("Failed to load"));
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (err) return <div className="max-w-6xl mx-auto"><PageHeader title="UW Equity" subtitle="Portfolio dashboard" /><div className="glass p-8 text-slate-400">{err}</div></div>;
  if (!data) return <div className="max-w-6xl mx-auto"><PageHeader title="UW Equity" subtitle="Portfolio dashboard" /><div className="glass p-8 text-slate-500">Loading portfolio…</div></div>;

  const p = data.portfolio;
  const subs = data.brands.filter((b: any) => !b.isParent);

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <PageHeader title="UW Equity" subtitle="Parent-company portfolio — all subsidiaries rolled up" />

      {/* Portfolio roll-up */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Stat label="Subsidiaries" value={p.brands} />
        <Stat label="Active missions" value={p.activeMissions} />
        <Stat label="Leads" value={p.leads} />
        <Stat label="Revenue (closed)" value={formatMoney(p.revenue.closed)} />
        <Stat label="Pipeline" value={formatMoney(p.revenue.pipeline)} />
        <Stat label="Blockers" value={p.blockers} warn={p.blockers > 0} />
      </div>

      {/* Lead-source mix + projects/objectives */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="glass p-5">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Leads by source (portfolio)</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(p.leadsBySource).map(([s, n]) => (
              <span key={s} className="text-xs px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-slate-300 capitalize">
                {s}: <span className="text-white font-semibold">{n as number}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="glass p-5 grid grid-cols-3 gap-3">
          <MiniStat label="Projects" value={`${p.projects.active}/${p.projects.total}`} sub="active/total" />
          <MiniStat label="Objectives" value={p.objectives.active} sub="active" />
          <MiniStat label="Commission" value={formatMoney(p.revenue.commission)} sub="closed" />
        </div>
      </div>

      {/* Per-brand breakdown */}
      <h3 className="text-sm font-semibold text-slate-300 mb-3">By brand</h3>
      <div className="grid md:grid-cols-2 gap-4">
        {subs.map((b: any) => (
          <div key={b.id} className="glass p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: b.colors?.primary }} />
              <h4 className="font-semibold text-white">{b.name}</h4>
              <span className="ml-auto text-[11px] text-slate-500 capitalize">{b.status}</span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <BrandStat label="Missions" value={b.missions.active} />
              <BrandStat label="Leads" value={b.leads.total} />
              <BrandStat label="Revenue" value={formatMoney(b.revenue.closed)} />
              <BrandStat label="Blockers" value={b.blockers.length} warn={b.blockers.length > 0} />
            </div>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
              <span>Pipeline {formatMoney(b.revenue.pipeline)}</span>
              <span>·</span>
              <span>Projects {b.projects.active}/{b.projects.total}</span>
              <span>·</span>
              <span>Objectives {b.objectives.active} · {b.objectives.avgProgress}% avg</span>
            </div>
            {b.blockers.length > 0 && (
              <ul className="mt-3 space-y-1">
                {b.blockers.slice(0, 4).map((bl: any, i: number) => (
                  <li key={i} className="text-xs text-amber-300/90 flex gap-1.5">
                    <span className="text-amber-400">▲</span><span className="truncate">{bl.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div className={`glass p-4 ${warn ? "border-amber-500/30" : ""}`}>
      <div className={`text-2xl font-bold ${warn ? "text-amber-300" : "text-white"}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-1">{label}</div>
    </div>
  );
}
function MiniStat({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold text-white">{value}</div>
      <div className="text-[11px] text-slate-400">{label}</div>
      {sub && <div className="text-[10px] text-slate-600">{sub}</div>}
    </div>
  );
}
function BrandStat({ label, value, warn }: { label: string; value: any; warn?: boolean }) {
  return (
    <div>
      <div className={`text-lg font-bold ${warn ? "text-amber-300" : "text-white"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
