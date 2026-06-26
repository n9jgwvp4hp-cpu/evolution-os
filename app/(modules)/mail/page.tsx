"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import GoogleConnect from "@/components/GoogleConnect";

type Mail = {
  id: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  unread: boolean;
};

export default function MailPage() {
  const [messages, setMessages] = useState<Mail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsConnect, setNeedsConnect] = useState(false);
  const [query, setQuery] = useState("");
  const [compose, setCompose] = useState(false);
  const [draft, setDraft] = useState({ to: "", subject: "", body: "" });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function load(q = "") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gmail${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      if (res.status === 401) { setNeedsConnect(true); return; }
      if (!res.ok) throw new Error(data.error || "Failed to load mail.");
      setMessages(data.messages || []);
      setNeedsConnect(false);
    } catch (e: any) {
      setError(e?.message || "Failed to load mail.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function send() {
    if (!draft.to.trim()) return;
    setSending(true);
    setSent(null);
    try {
      const res = await fetch("/api/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed.");
      setSent("✅ Email sent.");
      setDraft({ to: "", subject: "", body: "" });
      setCompose(false);
    } catch (e: any) {
      setSent("❌ " + (e?.message || "Send failed."));
    } finally {
      setSending(false);
    }
  }

  if (needsConnect) {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Gmail" subtitle="Read and send email from your assistant." />
        <GoogleConnect />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Gmail"
        subtitle="Your latest messages"
        action={
          <button className="btn-primary" onClick={() => setCompose((v) => !v)}>
            {compose ? "Close" : "✏️ Compose"}
          </button>
        }
      />

      {compose && (
        <div className="glass p-5 mb-5 space-y-3 animate-floatUp">
          <input className="input" placeholder="To" value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          <input className="input" placeholder="Subject" value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
          <textarea className="input resize-none min-h-[140px]" placeholder="Write your message…"
            value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <button className="btn-primary" onClick={send} disabled={sending}>
            {sending ? "Sending…" : "Send email"}
          </button>
        </div>
      )}
      {sent && <div className="glass px-4 py-2 mb-4 text-sm">{sent}</div>}

      <form
        onSubmit={(e) => { e.preventDefault(); load(query); }}
        className="flex gap-2 mb-4"
      >
        <input className="input flex-1" placeholder="Search mail (e.g. from:zillow)…"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn-ghost" type="submit">Search</button>
      </form>

      {loading && <div className="glass p-10 text-center text-slate-500">Loading inbox…</div>}
      {error && (
        <div className="text-sm text-pink-300 bg-pink-500/10 border border-pink-500/30 rounded-xl px-4 py-2 mb-4">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {messages.map((m) => (
          <div key={m.id} className={`glass p-4 ${m.unread ? "border-accent/30" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-sm truncate ${m.unread ? "text-white font-semibold" : "text-slate-300"}`}>
                {cleanFrom(m.from)}
              </span>
              <span className="text-[11px] text-slate-500 shrink-0">{shortDate(m.date)}</span>
            </div>
            <div className="text-sm text-slate-200 truncate mt-0.5">{m.subject || "(no subject)"}</div>
            <p className="text-xs text-slate-500 line-clamp-2 mt-1">{m.snippet}</p>
          </div>
        ))}
        {!loading && messages.length === 0 && !error && (
          <div className="glass p-10 text-center text-slate-500">No messages found.</div>
        )}
      </div>
    </div>
  );
}

function cleanFrom(from: string) {
  const match = from.match(/^(.*?)</);
  return (match ? match[1].trim() : from).replace(/"/g, "") || from;
}
function shortDate(date: string) {
  const d = new Date(date);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
