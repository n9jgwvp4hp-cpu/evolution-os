"use client";

/**
 * Operations Command Center — a live view of everything Evolution OS is doing.
 * Polls /api/ops for a full snapshot and renders: system health, kernel status,
 * active missions, upcoming scheduled work, the Priority Queue, recent decisions,
 * drafts + calendar actions awaiting approval, execution history, and errors/
 * retries — with real-time timestamps + durations, status filtering, and a
 * click-through execution timeline that explains every decision the OS made.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 8000;
const FILTERS = ["All", "Running", "Waiting", "Completed", "Failed"] as const;
type Filter = (typeof FILTERS)[number];

const fmtClock = (ts?: number | null) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
const fmtWhen = (ts?: number | null) => {
  if (!ts) return "—";
  const d = Date.now() - ts, s = Math.round(d / 1000);
  if (s < 0) return `in ${fmtDur(-d)}`;
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};
function fmtDur(ms?: number | null) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
const STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", needs_approval: "Waiting", done: "Completed", failed: "Failed" };
const STATUS_COLOR: Record<string, string> = { queued: "bg-sky-500/20 text-sky-300", running: "bg-emerald-500/20 text-emerald-300", needs_approval: "bg-amber-500/20 text-amber-300", done: "bg-slate-500/20 text-slate-300", failed: "bg-rose-500/20 text-rose-300" };
const HEALTH_DOT: Record<string, string> = { ok: "bg-emerald-400", degraded: "bg-amber-400", down: "bg-rose-500" };

function Badge({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_COLOR[status] || "bg-white/10"}`}>{STATUS_LABEL[status] || status}</span>;
}
function Card({ title, right, children }: any) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-200">{title}</h3>{right}</div>
      {children}
    </div>
  );
}

export default function OpsPage() {
  const [ops, setOps] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [selected, setSelected] = useState<any | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const timer = useRef<any>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/ops", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "failed");
      setOps(d); setUpdatedAt(Date.now()); setErr(null);
    } catch (e: any) { setErr(e?.message || "Could not load"); }
  }, []);

  useEffect(() => { load(); timer.current = setInterval(load, POLL_MS); return () => clearInterval(timer.current); }, [load]);

  // Click a mission -> fetch its full step log for the execution timeline.
  const openMission = useCallback(async (id: string) => {
    try {
      const r = await fetch("/api/missions", { cache: "no-store" });
      const d = await r.json();
      const m = (d.missions || []).find((x: any) => x.id === id);
      setSelected(m || { id, steps: [] });
    } catch { setSelected({ id, steps: [] }); }
  }, []);

  if (!ops) return <div className="p-8 text-slate-400">{err ? `Error: ${err}` : "Loading Operations Command Center…"}</div>;

  const all = [...ops.missions.active, ...ops.missions.scheduled, ...ops.missions.queuedNow, ...ops.missions.history]
    .filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i);
  const match = (m: any) =>
    filter === "All" ? true :
    filter === "Running" ? m.status === "running" :
    filter === "Waiting" ? ["needs_approval", "queued"].includes(m.status) :
    filter === "Completed" ? m.status === "done" :
    m.status === "failed";
  const list = all.filter(match).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Operations Command Center</h1>
          <p className="text-xs text-slate-400">Live · updated {fmtWhen(updatedAt)} · auto-refresh {POLL_MS / 1000}s</p>
        </div>
        <span className="flex items-center gap-2 text-xs text-emerald-300"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> live</span>
      </div>

      {/* system health */}
      <Card title="System Health">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {["database", "worker", "gmail", "calendar", "crm", "ai"].map((k) => {
            const h = ops.health[k];
            return (
              <div key={k} className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${HEALTH_DOT[h.status] || "bg-slate-500"}`} /><span className="text-xs font-medium capitalize text-slate-200">{k === "ai" ? "AI Provider" : k}</span></div>
                <div className="mt-1 text-[11px] text-slate-400">{h.detail}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* kernel */}
        <Card title="Background Kernel">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-400">Status</span><span className={`font-medium ${ops.kernel.status === "running" ? "text-emerald-300" : ops.kernel.status === "disabled" ? "text-rose-300" : "text-sky-300"}`}>{ops.kernel.status}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Enabled</span><span>{ops.kernel.enabled ? "yes" : "no"}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Cadence</span><span>every {ops.kernel.everyMin} min</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Next run</span><span>{fmtWhen(ops.kernel.nextRunAt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Last run</span><span>{fmtWhen(ops.kernel.lastRunAt)}</span></div>
          </div>
        </Card>

        {/* counts */}
        <Card title="Missions">
          <div className="grid grid-cols-3 gap-2 text-center">
            {Object.entries({ Running: "running", Waiting: "needs_approval", Queued: "queued", Completed: "done", Failed: "failed" }).map(([label, key]) => (
              <div key={label} className="rounded-lg bg-white/5 p-2"><div className="text-lg font-bold text-white">{ops.counts[key] || 0}</div><div className="text-[11px] text-slate-400">{label}</div></div>
            ))}
          </div>
        </Card>

        {/* awaiting approval */}
        <Card title="Awaiting Approval">
          <div className="space-y-2 text-sm">
            <div className="text-slate-300">✉️ Draft emails: <b>{ops.draftsAwaitingApproval.length}</b></div>
            {ops.draftsAwaitingApproval.slice(0, 3).map((d: any) => <div key={d.id} className="truncate text-xs text-slate-400">→ {d.subject} · {d.to}</div>)}
            <div className="mt-2 text-slate-300">📅 Calendar actions: <b>{ops.calendarActions.length}</b></div>
            {ops.calendarActions.slice(0, 3).map((c: any, i: number) => <div key={i} className="truncate text-xs text-slate-400">{c.title}</div>)}
          </div>
        </Card>
      </div>

      {/* filters + mission list */}
      <Card title="Missions" right={
        <div className="flex gap-1">{FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2 py-1 text-xs ${filter === f ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>{f}</button>)}</div>
      }>
        <div className="space-y-1">
          {list.length === 0 && <div className="py-4 text-center text-sm text-slate-500">No missions match “{filter}”.</div>}
          {list.slice(0, 60).map((m: any) => (
            <button key={m.id} onClick={() => openMission(m.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/5">
              <Badge status={m.status} />
              <span className="flex-1 truncate text-sm text-slate-200">{m.isKernel ? "🧠 " : ""}{m.objective}</span>
              <span className="hidden shrink-0 text-xs text-slate-500 sm:block">{m.scheduledFor && m.status === "queued" ? `runs ${fmtWhen(m.scheduledFor)}` : `${fmtDur(m.durationMs)} · ${fmtWhen(m.updatedAt)}`}</span>
              {m.attempts > 0 && <span className="shrink-0 rounded bg-amber-500/20 px-1.5 text-[11px] text-amber-300">↻{m.attempts}</span>}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* priority queue */}
        <Card title="Priority Queue" right={<span className="text-xs text-slate-500">{ops.priorities.length} ranked</span>}>
          <div className="space-y-2">
            {ops.priorities.length === 0 && <div className="text-sm text-slate-500">No priorities yet — the kernel builds this each cycle.</div>}
            {ops.priorities.slice(0, 8).map((p: any) => (
              <div key={p.id} className="rounded-lg bg-white/5 p-2">
                <div className="flex items-center justify-between"><span className="text-sm text-slate-200">{p.title}</span><span className="rounded bg-indigo-500/20 px-1.5 text-xs text-indigo-300">{p.score}</span></div>
                <div className="text-[11px] text-slate-400">→ {p.recommendedAction}</div>
                <div className="text-[11px] italic text-slate-500">why: {p.why}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* recent decisions */}
        <Card title="Recent Decisions">
          <div className="max-h-72 space-y-1 overflow-auto">
            {ops.recentDecisions.map((d: any, i: number) => (
              <div key={i} className="flex gap-2 text-xs"><span className="shrink-0 text-slate-500">{fmtClock(d.ts)}</span><span className="text-slate-300">{d.text}</span></div>
            ))}
          </div>
        </Card>

        {/* upcoming scheduled */}
        <Card title="Upcoming Scheduled Work">
          <div className="space-y-1">
            {ops.missions.scheduled.length === 0 && <div className="text-sm text-slate-500">Nothing scheduled.</div>}
            {ops.missions.scheduled.slice(0, 8).map((m: any) => (
              <button key={m.id} onClick={() => openMission(m.id)} className="flex w-full justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/5">
                <span className="flex-1 truncate text-slate-200">{m.isKernel ? "🧠 " : ""}{m.objective}</span>
                <span className="shrink-0 text-xs text-sky-300">{fmtWhen(m.scheduledFor)}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* errors & retries */}
        <Card title="Errors & Retries">
          <div className="space-y-1">
            {ops.missions.errorsRetries.length === 0 && <div className="text-sm text-slate-500">No errors or retries. 🎉</div>}
            {ops.missions.errorsRetries.slice(0, 8).map((m: any) => (
              <button key={m.id} onClick={() => openMission(m.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
                <Badge status={m.status} />
                <span className="flex-1 truncate text-sm text-slate-300">{m.objective}</span>
                {m.attempts > 0 && <span className="shrink-0 rounded bg-amber-500/20 px-1.5 text-[11px] text-amber-300">↻{m.attempts} attempts</span>}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* mission execution timeline modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onClick={() => setSelected(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-t-2xl bg-[#0b0d1a] p-5 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div><h3 className="font-semibold text-white">Execution Timeline</h3><p className="text-xs text-slate-400">{selected.objective}</p></div>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            {selected.result && <div className="mb-3 rounded-lg bg-white/5 p-2 text-sm text-slate-200"><b>Result:</b> {selected.result}</div>}
            <ol className="space-y-2 border-l border-white/10 pl-4">
              {(selected.steps || []).map((s: any) => (
                <li key={s.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-indigo-400" />
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 text-[11px] text-slate-500">{fmtClock(s.ts)}</span>
                    <span className="rounded bg-white/10 px-1.5 text-[10px] uppercase text-slate-400">{s.kind}</span>
                    <span className="text-sm text-slate-200">{s.text}</span>
                  </div>
                  {s.detail && <div className="ml-14 text-xs text-slate-500">{s.detail}</div>}
                </li>
              ))}
              {(!selected.steps || selected.steps.length === 0) && <li className="text-sm text-slate-500">No steps recorded.</li>}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
