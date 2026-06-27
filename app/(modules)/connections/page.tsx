"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";

type Status = { configured: boolean; connected: boolean; email: string | null };

export default function ConnectionsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  async function refresh() {
    try {
      const r = await fetch("/api/google/status", { cache: "no-store" });
      setStatus(await r.json());
    } catch {
      setStatus({ configured: false, connected: false, email: null });
    }
  }

  useEffect(() => {
    setOrigin(window.location.origin);
    refresh();
    const g = new URLSearchParams(window.location.search).get("google");
    if (g === "connected") setNotice("✅ Google connected.");
    else if (g === "denied") setNotice("Connection was cancelled.");
    else if (g) setNotice("❌ Google connection failed — check the OAuth client + redirect URI.");
    if (g) window.history.replaceState({}, "", "/connections");
  }, []);

  async function disconnect() {
    await fetch("/api/google/disconnect", { method: "POST" });
    setNotice("Disconnected from Google.");
    refresh();
  }

  const connected = status?.connected;
  const configured = status?.configured;

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader title="Connections" subtitle="Services Evolution can act through." />

      {notice && <div className="glass px-4 py-2 mb-4 text-sm">{notice}</div>}

      {/* Google card */}
      <div className="glass p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-white font-semibold text-lg">Google</h3>
            <p className="text-sm text-slate-500 mt-0.5">
              {connected
                ? `Connected${status?.email ? ` as ${status.email}` : ""}.`
                : "Lets missions read & send email and manage your calendar."}
            </p>
          </div>
          <span
            className={`w-3 h-3 rounded-full shrink-0 ${
              connected ? "bg-emerald-400 animate-pulseGlow" : "bg-slate-600"
            }`}
          />
        </div>

        {/* What it enables */}
        <div className="grid sm:grid-cols-2 gap-3 mt-5">
          <Capability ok={!!connected} icon="✉️" title="Gmail" desc="Read recent mail; send email from missions." />
          <Capability ok={!!connected} icon="📅" title="Calendar" desc="View upcoming events; create events from missions." />
        </div>

        <div className="mt-5">
          {status === null ? (
            <p className="text-sm text-slate-500">Checking status…</p>
          ) : !configured ? (
            <NotConfigured origin={origin} />
          ) : connected ? (
            <button className="btn-ghost" onClick={disconnect}>Disconnect Google</button>
          ) : (
            <a href="/api/google/auth" className="btn-primary inline-flex">Connect Google account</a>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-600 mt-4 leading-relaxed">
        Tokens are stored server-side (never exposed to the browser) and used by the always-on worker so
        background missions can act on your behalf. Disconnecting revokes that access immediately.
      </p>
    </div>
  );
}

function Capability({ ok, icon, title, desc }: { ok: boolean; icon: string; title: string; desc: string }) {
  return (
    <div className={`rounded-xl border p-3 ${ok ? "border-emerald-500/30 bg-emerald-500/[0.05]" : "border-white/10 bg-white/[0.02]"}`}>
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <span className="text-sm font-medium text-slate-100">{title}</span>
        <span className={`ml-auto text-[11px] ${ok ? "text-emerald-300" : "text-slate-500"}`}>
          {ok ? "active" : "inactive"}
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-1">{desc}</p>
    </div>
  );
}

function NotConfigured({ origin }: { origin: string }) {
  return (
    <div className="text-xs text-slate-500 leading-relaxed space-y-2">
      <p className="text-slate-400">Google isn&apos;t configured on the server yet. One-time setup:</p>
      <ol className="list-decimal list-inside space-y-1">
        <li>
          Create an OAuth client (Web application) at{" "}
          <a className="text-accent hover:underline" target="_blank" rel="noreferrer"
             href="https://console.cloud.google.com/apis/credentials">Google Cloud Console</a>.
        </li>
        <li>Enable the <span className="text-accent">Gmail API</span> and <span className="text-accent">Google Calendar API</span>.</li>
        <li>
          Add the authorized redirect URI:{" "}
          <code className="text-accent">{origin}/api/google/callback</code>
        </li>
        <li>
          Set <code className="text-accent">GOOGLE_CLIENT_ID</code>,{" "}
          <code className="text-accent">GOOGLE_CLIENT_SECRET</code>, and{" "}
          <code className="text-accent">GOOGLE_REDIRECT_URI</code> on the server, then reload.
        </li>
      </ol>
    </div>
  );
}
