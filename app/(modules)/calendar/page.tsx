"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import GoogleConnect from "@/components/GoogleConnect";

type Event = {
  id: string;
  summary: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  link: string;
};

export default function CalendarPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ summary: "", start: "", end: "", location: "" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar");
      const data = await res.json();
      if (res.status === 401) { setNeedsConnect(true); return; }
      if (!res.ok) throw new Error(data.error || "Failed to load calendar.");
      setEvents(data.events || []);
      setNeedsConnect(false);
    } catch (e: any) {
      setError(e?.message || "Failed to load calendar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function create() {
    if (!draft.summary.trim() || !draft.start) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create failed.");
      setMsg("✅ Event created.");
      setDraft({ summary: "", start: "", end: "", location: "" });
      setShowForm(false);
      load();
    } catch (e: any) {
      setMsg("❌ " + (e?.message || "Create failed."));
    } finally {
      setSaving(false);
    }
  }

  if (needsConnect) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Calendar" subtitle="Your upcoming schedule." />
        <GoogleConnect />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Calendar"
        subtitle="Upcoming events"
        action={
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Close" : "+ New event"}
          </button>
        }
      />

      {showForm && (
        <div className="glass p-5 mb-5 grid sm:grid-cols-2 gap-3 animate-floatUp">
          <input className="input sm:col-span-2" placeholder="Event title *" value={draft.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          <label className="text-xs text-slate-400">Start
            <input className="input mt-1" type="datetime-local" value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          </label>
          <label className="text-xs text-slate-400">End (optional)
            <input className="input mt-1" type="datetime-local" value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </label>
          <input className="input sm:col-span-2" placeholder="Location (optional)" value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          <button className="btn-primary" onClick={create} disabled={saving}>
            {saving ? "Saving…" : "Add to calendar"}
          </button>
        </div>
      )}
      {msg && <div className="glass px-4 py-2 mb-4 text-sm">{msg}</div>}

      {loading && <div className="glass p-10 text-center text-slate-500">Loading calendar…</div>}
      {error && (
        <div className="text-sm text-pink-300 bg-pink-500/10 border border-pink-500/30 rounded-xl px-4 py-2 mb-4">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {events.map((e) => (
          <a key={e.id} href={e.link} target="_blank" rel="noreferrer"
             className="glass p-4 flex items-center gap-4 hover:border-accent/30 transition">
            <div className="text-center shrink-0 w-14">
              <div className="text-accent text-xs uppercase">{dayPart(e.start, "month")}</div>
              <div className="text-white text-xl font-bold leading-none">{dayPart(e.start, "day")}</div>
            </div>
            <div className="min-w-0">
              <div className="text-slate-100 font-medium truncate">{e.summary}</div>
              <div className="text-xs text-slate-500">
                {e.allDay ? "All day" : timePart(e.start)}
                {e.location ? ` · ${e.location}` : ""}
              </div>
            </div>
          </a>
        ))}
        {!loading && events.length === 0 && !error && (
          <div className="glass p-10 text-center text-slate-500">No upcoming events.</div>
        )}
      </div>
    </div>
  );
}

function dayPart(iso: string, part: "month" | "day") {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return part === "month"
    ? d.toLocaleDateString(undefined, { month: "short" })
    : String(d.getDate());
}
function timePart(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short", hour: "2-digit", minute: "2-digit",
  });
}
