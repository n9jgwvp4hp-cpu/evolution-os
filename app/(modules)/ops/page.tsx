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
// One-tap mission templates — each starts a real mission via /api/missions.
const QUICK_ACTIONS: { label: string; objective: string }[] = [
  { label: "Draft replies to unread leads", objective: "Draft personalized replies to my unread lead emails and leave them awaiting my approval." },
  { label: "Weekly market update", objective: "Prepare a concise weekly market update summarizing the most important news relevant to my business." },
  { label: "Prep for tomorrow's meetings", objective: "Review tomorrow's calendar and prepare a briefing for each meeting with context, attendees, and talking points." },
];

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

/** One of the four autonomous-mission command-center sections. */
function MissionSection({ title, accent, items, empty, showDeps }: { title: string; accent: string; items: any[]; empty: string; showDeps?: boolean }) {
  const overdue = (d?: number | null) => d && d < Date.now();
  return (
    <div className="glass rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className={`text-sm font-semibold ${accent}`}>{title}</h3>
        <span className="text-xs text-slate-500">{items?.length || 0}</span>
      </div>
      {!items || items.length === 0 ? (
        <p className="text-sm text-slate-600">{empty}</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {items.slice(0, 25).map((m) => (
            <div key={m.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
              <div className="flex items-start gap-2">
                <span className="flex-1 min-w-0 text-sm text-slate-200 line-clamp-2">{m.objective}</span>
                <span className="text-[10px] text-slate-500 shrink-0">P{m.priority ?? 0}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent2" style={{ width: `${m.progress ?? 0}%` }} />
                </div>
                <span className="text-[10px] text-slate-500 w-8 text-right">{m.progress ?? 0}%</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                {m.deadline && <span className={overdue(m.deadline) ? "text-pink-400" : ""}>{overdue(m.deadline) ? "overdue" : "due"} {new Date(m.deadline).toLocaleDateString()}</span>}
                {showDeps && (m.dependencies?.length ? <span>· blocked by {m.dependencies.length} dep(s)</span> : m.status === "failed" ? <span>· failed</span> : m.status === "paused" ? <span>· paused</span> : null)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OpsPage() {
  const [ops, setOps] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [selected, setSelected] = useState<any | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [launching, setLaunching] = useState<string | null>(null);
  const [launchNote, setLaunchNote] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  const [delayMin, setDelayMin] = useState(0);
  const [everyMin, setEveryMin] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createNote, setCreateNote] = useState<string | null>(null);
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

  // Start a mission from a one-tap template, then refresh the snapshot.
  const launchMission = useCallback(async (objective: string, label: string) => {
    setLaunching(label); setLaunchNote(null);
    try {
      const r = await fetch("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not start mission.");
      setLaunchNote(`Started “${label}” — it's running in the background.`);
      load();
    } catch (e: any) { setLaunchNote(e?.message || "Could not start mission."); }
    finally { setLaunching(null); }
  }, [load]);

  // Create a mission from the Command Center — queues it on the same persistent
  // engine the worker auto-picks up. Optional delay / repeat interval.
  const createMission = useCallback(async () => {
    const obj = objective.trim();
    if (!obj || creating) return;
    setCreating(true); setCreateNote(null);
    try {
      const r = await fetch("/api/missions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: obj, delayMinutes: Number(delayMin) || 0, everyMinutes: Number(everyMin) || 0 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not queue mission.");
      setObjective(""); setDelayMin(0); setEveryMin(0);
      setCreateNote(`Queued — mission ${d.id} will be picked up by the worker.`);
      load();
    } catch (e: any) { setCreateNote(e?.message || "Could not queue mission."); }
    finally { setCreating(false); }
  }, [objective, delayMin, everyMin, creating, load]);

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

      {/* Autonomous mission system — the four sections + timeline. */}
      {ops.sections && (
        <div className="grid gap-4 lg:grid-cols-2">
          <MissionSection title="In progress" accent="text-sky-300" items={ops.sections.inProgress} empty="Nothing running right now." />
          <MissionSection title="Waiting for approval" accent="text-violet-300" items={ops.sections.waitingApproval} empty="No decisions needed." />
          <MissionSection title="Blocked" accent="text-amber-300" items={ops.sections.blocked} empty="Nothing blocked." showDeps />
          <MissionSection title="Completed while away" accent="text-emerald-300" items={ops.sections.completedWhileAway} empty="All caught up." />
        </div>
      )}

      {ops.missionTimeline && (
        <Card title="Timeline" right={<span className="text-xs text-slate-500">every mission created + completed</span>}>
          {ops.missionTimeline.length === 0 ? (
            <p className="text-sm text-slate-500">No mission activity yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {ops.missionTimeline.map((a: any) => (
                <div key={a.id} className="flex items-start gap-2 text-sm">
                  <span>{a.kind === "mission_completed" ? "✅" : a.kind === "mission_failed" ? "⛔" : "🚀"}</span>
                  <span className="flex-1 min-w-0 text-slate-300">{a.title}</span>
                  <span className="text-[11px] text-slate-600 shrink-0">{fmtWhen(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* quick actions — one-tap mission templates */}
      <Card title="Quick Actions" right={launchNote && <span className="text-xs text-slate-400">{launchNote}</span>}>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((q) => (
            <button
              key={q.label}
              onClick={() => launchMission(q.objective, q.label)}
              disabled={launching !== null}
              className="rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {launching === q.label ? "Starting…" : `⚡ ${q.label}`}
            </button>
          ))}
        </div>
      </Card>

      {/* system health */}
      <Card title="System Health">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {["database", "scheduler", "worker", "gmail", "calendar", "crm", "ai"].map((k) => {
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

      {/* continuous workflow orchestrator */}
      <Card title="Continuous Workflow Orchestrator" right={
        ops.orchestrator
          ? <span className="flex items-center gap-1">
              {ops.orchestrator.mode === "daemon" && <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">persistent</span>}
              <span className={`rounded-full px-2 py-0.5 text-xs ${ops.orchestrator.running ? "bg-emerald-500/20 text-emerald-300" : ops.orchestrator.phase === "blocked" || ops.orchestrator.phase === "failed" || ops.orchestrator.phase === "stopped" ? "bg-rose-500/20 text-rose-300" : "bg-white/10 text-slate-300"}`}>{ops.orchestrator.running ? "running" : ops.orchestrator.phase}</span>
            </span>
          : <span className="text-xs text-slate-500">not started</span>
      }>
        {!ops.orchestrator ? (
          <p className="text-sm text-slate-500">Start the persistent runner with <code className="rounded bg-white/10 px-1">npm run orchestrate:start</code> — status appears here live.</p>
        ) : (() => {
          const done = (ops.orchestrator.milestones || []).filter((m: any) => m.status === "done");
          const failed = (ops.orchestrator.milestones || []).filter((m: any) => m.status === "failed" || m.status === "blocked");
          return (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Phase</span><span className="font-medium text-slate-200">{ops.orchestrator.phase}{ops.orchestrator.mode === "daemon" ? " · persistent" : ""}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Current milestone</span><span className="truncate text-slate-200">{ops.orchestrator.currentMilestone || "—"}{ops.orchestrator.attempt ? ` (try ${ops.orchestrator.attempt}/${ops.orchestrator.maxRetries})` : ""}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Completed</span><span className="text-emerald-300">{done.length}/{(ops.orchestrator.milestones || []).length}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Failed</span><span className={failed.length ? "text-rose-300" : "text-slate-500"}>{failed.length ? failed.map((m: any) => m.id).join(", ") : "none"}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Last run</span><span>{fmtWhen(ops.orchestrator.lastRunAt)}</span></div>
              <div className="flex justify-between"><span className="text-slate-400">Next scheduled run</span><span className="text-sky-300">{ops.orchestrator.nextRunAt ? fmtWhen(ops.orchestrator.nextRunAt) : "—"}</span></div>
              <div className="pt-1 text-xs text-slate-400">{ops.orchestrator.message}</div>
              <div className="mt-2 space-y-0.5">
                {(ops.orchestrator.milestones || []).slice(0, 8).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between text-xs">
                    <span className="truncate text-slate-300">{m.title}</span>
                    <span className={`ml-2 shrink-0 ${m.status === "done" ? "text-emerald-300" : m.status === "failed" || m.status === "blocked" ? "text-rose-300" : m.status === "in_progress" ? "text-amber-300" : "text-slate-500"}`}>{m.status}{m.attempts ? ` ·↻${m.attempts}` : ""}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="max-h-52 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-[11px] text-slate-400">
              {(ops.orchestrator.recent || []).slice(-30).map((r: any, i: number) => <div key={i}><span className="text-slate-600">{fmtClock(r.ts)}</span> {r.text}</div>)}
              {(!ops.orchestrator.recent || ops.orchestrator.recent.length === 0) && <div className="text-slate-600">no log yet</div>}
            </div>
          </div>
          ); })()}
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

      {/* create + filters + mission list */}
      <Card title="Mission Queue" right={
        <div className="flex gap-1">{FILTERS.map((f) => <button key={f} onClick={() => setFilter(f)} className={`rounded-md px-2 py-1 text-xs ${filter === f ? "bg-indigo-500 text-white" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>{f}</button>)}</div>
      }>
        {/* create a mission */}
        <div className="mb-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") createMission(); }}
            placeholder="New mission — describe an objective (e.g. “Research the 5 newest condo listings under $600k in Brickell and save a note”). ⌘↵ to queue."
            className="min-h-[64px] w-full resize-none rounded-lg bg-black/30 p-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <label className="flex items-center gap-1">start in <input type="number" min={0} value={delayMin} onChange={(e) => setDelayMin(Math.max(0, Number(e.target.value)))} className="w-14 rounded bg-black/30 px-1 py-0.5 text-slate-100" /> min</label>
            <label className="flex items-center gap-1">repeat every <input type="number" min={0} value={everyMin} onChange={(e) => setEveryMin(Math.max(0, Number(e.target.value)))} className="w-16 rounded bg-black/30 px-1 py-0.5 text-slate-100" /> min <span className="text-slate-600">(0 = once)</span></label>
            <button onClick={createMission} disabled={!objective.trim() || creating} className="ml-auto rounded-lg bg-indigo-500 px-3 py-1.5 font-medium text-white hover:bg-indigo-400 disabled:opacity-40">{creating ? "Queuing…" : "Queue mission"}</button>
          </div>
          {createNote && <div className="mt-2 text-xs text-emerald-300">{createNote}</div>}
        </div>
        <div className="space-y-1">
          {list.length === 0 && <div className="py-4 text-center text-sm text-slate-500">No missions match “{filter}”.</div>}
          {list.slice(0, 60).map((m: any) => (
            <button key={m.id} onClick={() => openMission(m.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/5">
              <Badge status={m.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-200">{m.isKernel ? "🧠 " : ""}{m.objective}</span>
                {m.status === "running" && m.currentStep && <span className="block truncate text-[11px] text-emerald-300">▶ {m.currentStep}</span>}
              </span>
              <span className="hidden shrink-0 text-right text-xs text-slate-500 sm:block">
                {m.scheduledFor && m.status === "queued" ? `runs ${fmtWhen(m.scheduledFor)}` : `${fmtDur(m.durationMs)} · ${fmtWhen(m.updatedAt)}`}
                {m.stepCount > 0 && <span className="block text-[10px] text-slate-600">{m.actionCount} actions · {m.stepCount} steps</span>}
              </span>
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
            {selected.result && <div className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-2 text-sm text-slate-100"><b className="text-emerald-300">Final outcome:</b> {selected.result}</div>}
            <p className="mb-2 text-[11px] uppercase tracking-widest text-slate-600">Execution timeline — plan · actions · tool calls · results · errors</p>
            <ol className="space-y-2 border-l border-white/10 pl-4">
              {(selected.steps || []).map((s: any) => {
                const label = ({ plan: "Plan", action: "Tool call", result: "Result", error: "Error", status: "Status", progress: "Progress" } as any)[s.kind] || s.kind;
                const err = s.kind === "error";
                return (
                  <li key={s.id} className="relative">
                    <span className={`absolute -left-[21px] top-1 h-2 w-2 rounded-full ${err ? "bg-rose-500" : s.kind === "action" ? "bg-sky-400" : s.kind === "result" ? "bg-emerald-400" : "bg-indigo-400"}`} />
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-[11px] text-slate-500">{fmtClock(s.ts)}</span>
                      <span className={`rounded px-1.5 text-[10px] uppercase ${err ? "bg-rose-500/20 text-rose-300" : "bg-white/10 text-slate-400"}`}>{label}</span>
                      <span className={`text-sm ${err ? "text-rose-300" : "text-slate-200"}`}>{s.text}</span>
                    </div>
                    {s.detail && <div className="ml-14 text-xs text-slate-500">{s.detail}</div>}
                  </li>
                );
              })}
              {(!selected.steps || selected.steps.length === 0) && <li className="text-sm text-slate-500">No steps recorded.</li>}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
