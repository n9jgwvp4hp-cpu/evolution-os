"use client";

import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";

/**
 * Connections — per-brand Google (Gmail + Calendar) accounts. Each brand connects
 * its OWN Google account; Evolution OS then automatically sends mail, schedules
 * meetings, and follows up from the correct brand identity. A brand that hasn't
 * connected its own account operates through the parent (UW Equity) until it does.
 */
type Conn = {
  brandId: string; name: string; isParent: boolean;
  connected: boolean; email: string | null;
  effective: "brand" | "parent" | "legacy" | "none"; effectiveEmail: string | null;
};

export default function ConnectionsPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [conns, setConns] = useState<Conn[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/brands/connections", { cache: "no-store" });
      const d = await r.json();
      setConfigured(!!d.configured);
      setConns(d.connections || []);
    } catch { setConfigured(false); }
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    refresh();
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    if (g === "connected") setNotice("✅ Google connected for the brand.");
    else if (g === "denied") setNotice("Connection was cancelled.");
    else if (g) setNotice("❌ Google connection failed.");
    if (g) window.history.replaceState({}, "", "/connections");
  }, [refresh]);

  async function disconnect(brandId: string) {
    await fetch(`/api/google/disconnect?brandId=${brandId}`, { method: "POST" });
    setNotice("Disconnected that brand's Google account.");
    refresh();
  }

  const ordered = [...conns].sort((a, b) => Number(b.isParent) - Number(a.isParent) || a.name.localeCompare(b.name));

  return (
    <div className="max-w-2xl mx-auto pb-16">
      <PageHeader title="Connections" subtitle="Each brand's own Gmail + Calendar. Evolution OS auto-selects the right one." />
      {notice && <div className="glass px-4 py-2 mb-4 text-sm">{notice}</div>}

      {configured === false ? <NotConfigured origin={origin} /> : (
        <div className="space-y-3">
          {ordered.map((c) => (
            <div key={c.brandId} className="glass p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-white font-semibold flex items-center gap-2">
                    {c.name}
                    {c.isParent && <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/20 text-accent uppercase tracking-wide">Parent</span>}
                  </h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {c.connected
                      ? `Connected as ${c.email || "its own account"}.`
                      : c.effective === "none"
                        ? "Not connected — connect this brand's Google account."
                        : `Operating through the ${c.effective === "parent" ? "UW Equity portfolio" : "primary"} account${c.effectiveEmail ? ` (${c.effectiveEmail})` : ""} until connected.`}
                  </p>
                </div>
                <span className={`w-3 h-3 rounded-full shrink-0 ${c.connected ? "bg-emerald-400 animate-pulseGlow" : c.effective !== "none" ? "bg-amber-400/70" : "bg-slate-600"}`} />
              </div>

              <div className="grid sm:grid-cols-2 gap-3 mt-4">
                <Capability ok={c.connected} icon="✉️" title="Gmail" desc="Send email + drafts as this brand." />
                <Capability ok={c.connected} icon="📅" title="Calendar" desc="Create events + invites on this brand's calendar." />
              </div>

              <div className="mt-4 flex gap-2">
                <a href={`/api/google/auth?brandId=${c.brandId}`} className="btn-primary inline-flex text-sm">
                  {c.connected ? "Reconnect" : "Connect Google"}
                </a>
                {c.connected && <button className="btn-ghost text-sm" onClick={() => disconnect(c.brandId)}>Disconnect</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-600 mt-4 leading-relaxed">
        One consent grants both Gmail and Calendar for that brand. Tokens are stored server-side per brand
        (never exposed to the browser) and used by the always-on worker so background missions act from the
        correct brand identity. Disconnecting revokes that brand's access immediately.
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
        <span className={`ml-auto text-[11px] ${ok ? "text-emerald-300" : "text-slate-500"}`}>{ok ? "active" : "inactive"}</span>
      </div>
      <p className="text-xs text-slate-500 mt-1">{desc}</p>
    </div>
  );
}

function NotConfigured({ origin }: { origin: string }) {
  return (
    <div className="glass p-6 text-xs text-slate-500 leading-relaxed space-y-2">
      <p className="text-slate-400">Google isn&apos;t configured on the server yet. One-time setup:</p>
      <ol className="list-decimal list-inside space-y-1">
        <li>Create an OAuth client (Web application) at <a className="text-accent hover:underline" target="_blank" rel="noreferrer" href="https://console.cloud.google.com/apis/credentials">Google Cloud Console</a>.</li>
        <li>Enable the <span className="text-accent">Gmail API</span> and <span className="text-accent">Google Calendar API</span>.</li>
        <li>Add the authorized redirect URI: <code className="text-accent">{origin}/api/google/callback</code></li>
        <li>Set <code className="text-accent">GOOGLE_CLIENT_ID</code>, <code className="text-accent">GOOGLE_CLIENT_SECRET</code>, and <code className="text-accent">GOOGLE_REDIRECT_URI</code> on the server, then reload.</li>
      </ol>
    </div>
  );
}
