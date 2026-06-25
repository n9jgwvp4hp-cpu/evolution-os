"use client";

import { useEffect, useState } from "react";

type Status = { configured: boolean; connected: boolean; email: string | null };

export default function GoogleSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/google/status");
      setStatus(await r.json());
    } catch {
      setStatus({ configured: false, connected: false, email: null });
    }
  }

  useEffect(() => {
    refresh();
    // Surface the result of the OAuth redirect (?google=connected etc.)
    const params = new URLSearchParams(window.location.search);
    const g = params.get("google");
    if (g === "connected") setNotice("✅ Google connected.");
    else if (g === "denied") setNotice("Connection was cancelled.");
    else if (g) setNotice("❌ Google connection failed. Check your credentials.");
    if (g) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  async function disconnect() {
    await fetch("/api/google/disconnect", { method: "POST" });
    setNotice("Disconnected from Google.");
    refresh();
  }

  return (
    <div className="glass p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-white font-semibold">Google · Gmail &amp; Calendar</h3>
          <p className="text-sm text-slate-500 mt-1">
            {status?.connected
              ? `Connected${status.email ? ` as ${status.email}` : ""}.`
              : "Connect to read & send email and manage your calendar."}
          </p>
        </div>
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            status?.connected ? "bg-emerald-400 animate-pulseGlow" : "bg-slate-600"
          }`}
        />
      </div>

      {notice && <div className="text-sm mt-3 text-slate-300">{notice}</div>}

      <div className="mt-4">
        {status && !status.configured && (
          <div className="text-xs text-slate-500 leading-relaxed mb-3">
            Add <code className="text-accent">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="text-accent">GOOGLE_CLIENT_SECRET</code> to{" "}
            <code className="text-accent">.env.local</code> (see{" "}
            <code className="text-accent">.env.local.example</code>), then restart the
            dev server. Create credentials in the{" "}
            <a className="text-accent hover:underline" target="_blank" rel="noreferrer"
               href="https://console.cloud.google.com/apis/credentials">
              Google Cloud Console
            </a>.
          </div>
        )}

        {status?.connected ? (
          <button className="btn-ghost" onClick={disconnect}>Disconnect Google</button>
        ) : (
          <a
            href="/api/google/auth"
            className={`btn-primary inline-flex ${
              status && !status.configured ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            Connect Google account
          </a>
        )}
      </div>
    </div>
  );
}
