"use client";

/**
 * Automations — create, enable/disable, inspect, and delete event-driven rules.
 * Each rule watches an integration (Gmail / Calendar / schedule / webhook) and
 * queues a mission when it fires. Missions do only safe preparatory work.
 */

import { useCallback, useEffect, useState } from "react";

const TYPES = [
  { v: "email", label: "When I get an email…" },
  { v: "calendar", label: "Before a meeting…" },
  { v: "schedule", label: "On a schedule…" },
  { v: "webhook", label: "When a webhook fires…" },
] as const;

const blank = { name: "", type: "email", from: "", subjectContains: "", leadMinutes: 60, atTime: "08:00", everyMinutes: 0, objective: "" };

export default function AutomationsPage() {
  const [rules, setRules] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [form, setForm] = useState<any>(blank);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [inspect, setInspect] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await (await fetch("/api/automations", { cache: "no-store" })).json();
    setRules(d.rules || []); setLog(d.eventLog || []);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const create = async () => {
    if (!form.name.trim() || !form.objective.trim()) { setNote("Name and mission objective are required."); return; }
    setBusy(true); setNote(null);
    try {
      const r = await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      setForm(blank); setNote("Rule created."); load();
    } catch (e: any) { setNote(e?.message || "Failed"); } finally { setBusy(false); }
  };
  const patch = async (id: string, body: any) => { await fetch(`/api/automations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); load(); };
  const remove = async (id: string) => { await fetch(`/api/automations/${id}`, { method: "DELETE" }); load(); };

  const cond = (r: any) =>
    r.type === "email" ? `from ${r.from || "anyone"}${r.subjectContains ? ` · subject ~ "${r.subjectContains}"` : ""}` :
    r.type === "calendar" ? `${r.leadMinutes || 60} min before a meeting` :
    r.type === "schedule" ? (r.everyMinutes ? `every ${r.everyMinutes} min` : `daily at ${r.atTime || "08:00"} UTC`) :
    "on inbound webhook";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Automations</h1>
        <p className="text-xs text-slate-400">Event-driven rules that queue missions when something happens. Missions do safe prep only — they never send email or change your calendar.</p>
      </div>

      {/* create */}
      <div className="glass rounded-2xl p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">New rule</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Rule name (e.g. “Hot lead reply prep”)" className="rounded-lg bg-black/30 p-2 text-sm text-slate-100 placeholder:text-slate-500" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-lg bg-black/30 p-2 text-sm text-slate-100">
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>

          {form.type === "email" && <>
            <input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="Sender contains (email or name), optional" className="rounded-lg bg-black/30 p-2 text-sm text-slate-100 placeholder:text-slate-500" />
            <input value={form.subjectContains} onChange={(e) => setForm({ ...form, subjectContains: e.target.value })} placeholder="Subject contains, optional" className="rounded-lg bg-black/30 p-2 text-sm text-slate-100 placeholder:text-slate-500" />
          </>}
          {form.type === "calendar" && <label className="flex items-center gap-2 text-sm text-slate-300">fire <input type="number" min={5} value={form.leadMinutes} onChange={(e) => setForm({ ...form, leadMinutes: Number(e.target.value) })} className="w-20 rounded bg-black/30 p-1 text-slate-100" /> minutes before a meeting</label>}
          {form.type === "schedule" && <>
            <label className="flex items-center gap-2 text-sm text-slate-300">daily at <input value={form.atTime} onChange={(e) => setForm({ ...form, atTime: e.target.value })} placeholder="HH:MM UTC" className="w-24 rounded bg-black/30 p-1 text-slate-100" /> UTC</label>
            <label className="flex items-center gap-2 text-sm text-slate-300">or every <input type="number" min={0} value={form.everyMinutes} onChange={(e) => setForm({ ...form, everyMinutes: Number(e.target.value) })} className="w-20 rounded bg-black/30 p-1 text-slate-100" /> min (0 = use time)</label>
          </>}

          <textarea value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="Mission to run when this fires (e.g. “Prepare a briefing for the upcoming meeting: research the attendees and summarize relevant context into a note.”)" className="min-h-[64px] rounded-lg bg-black/30 p-2 text-sm text-slate-100 placeholder:text-slate-500 sm:col-span-2" />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={create} disabled={busy} className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-400 disabled:opacity-40">{busy ? "Creating…" : "Create rule"}</button>
          {note && <span className="text-xs text-emerald-300">{note}</span>}
        </div>
      </div>

      {/* rules */}
      <div className="glass rounded-2xl p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Rules ({rules.length})</h3>
        {rules.length === 0 && <p className="text-sm text-slate-500">No rules yet. Create one above.</p>}
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="rounded-xl bg-white/5 p-3">
              <div className="flex items-center gap-3">
                <button onClick={() => patch(r.id, { enabled: !r.enabled })} className={`h-5 w-9 shrink-0 rounded-full ${r.enabled ? "bg-emerald-500" : "bg-slate-600"} relative transition`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${r.enabled ? "left-[18px]" : "left-0.5"}`} /></button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><span className="truncate text-sm font-medium text-slate-100">{r.name}</span><span className="rounded bg-white/10 px-1.5 text-[10px] uppercase text-slate-400">{r.type}</span></div>
                  <div className="truncate text-xs text-slate-400">{cond(r)} · fired {r.triggerCount || 0}×{r.lastTriggeredAt ? ` · last ${new Date(r.lastTriggeredAt).toLocaleString()}` : ""}</div>
                </div>
                <button onClick={() => setInspect(inspect === r.id ? null : r.id)} className="shrink-0 rounded-md bg-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/20">Inspect</button>
                <button onClick={() => remove(r.id)} className="shrink-0 rounded-md bg-rose-500/20 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/30">Delete</button>
              </div>
              {inspect === r.id && (
                <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs text-slate-400">
                  <div><b className="text-slate-300">Mission:</b> {r.objective}</div>
                  {r.type === "webhook" && <div><b className="text-slate-300">Webhook URL:</b> <code className="break-all rounded bg-black/40 px-1">POST {typeof window !== "undefined" ? window.location.origin : ""}/api/events/{r.webhookToken}</code></div>}
                  <div><b className="text-slate-300">Recent triggers:</b></div>
                  {log.filter((e) => e.ruleId === r.id).slice(0, 5).map((e, i) => <div key={i} className="ml-2">• {new Date(e.ts).toLocaleTimeString()} — {e.event} → mission {e.missionId}</div>)}
                  {log.filter((e) => e.ruleId === r.id).length === 0 && <div className="ml-2 text-slate-600">none yet</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* global event log */}
      <div className="glass rounded-2xl p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Recent triggers (all rules)</h3>
        {log.length === 0 ? <p className="text-sm text-slate-500">No triggers yet.</p> :
          <div className="max-h-64 space-y-1 overflow-auto font-mono text-[11px] text-slate-400">
            {log.slice(0, 40).map((e, i) => <div key={i}><span className="text-slate-600">{new Date(e.ts).toLocaleTimeString()}</span> <span className="text-indigo-300">[{e.ruleName}]</span> {e.event} → <span className="text-slate-500">{e.missionId}</span></div>)}
          </div>}
      </div>
    </div>
  );
}
