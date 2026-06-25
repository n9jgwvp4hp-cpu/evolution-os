"use client";

import { useEffect, useState } from "react";

/**
 * Shown when a Google-powered feature (Gmail / Calendar) is used but the
 * account isn't connected yet. Handles both "not configured" (missing env
 * credentials) and "configured but not signed in" states.
 */
export default function GoogleConnect() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/google/status")
      .then((r) => r.json())
      .then((d) => setConfigured(Boolean(d.configured)))
      .catch(() => setConfigured(false));
  }, []);

  return (
    <div className="glass p-8 text-center max-w-md mx-auto">
      <div className="text-4xl mb-3">🔗</div>
      <h3 className="text-lg font-semibold text-white">Connect Google</h3>

      {configured === false ? (
        <div className="text-sm text-slate-400 mt-2 space-y-2 text-left">
          <p>Google isn&apos;t configured yet. To enable Gmail &amp; Calendar:</p>
          <ol className="list-decimal list-inside space-y-1 text-slate-500">
            <li>
              Create an OAuth client at{" "}
              <a className="text-accent hover:underline" target="_blank" rel="noreferrer"
                 href="https://console.cloud.google.com/apis/credentials">
                Google Cloud Console
              </a>
            </li>
            <li>Enable the Gmail API and Google Calendar API</li>
            <li>
              Add redirect URI{" "}
              <code className="text-accent text-xs">
                {typeof window !== "undefined" ? window.location.origin : ""}/api/google/callback
              </code>
            </li>
            <li>
              Put <code className="text-accent text-xs">GOOGLE_CLIENT_ID</code> and{" "}
              <code className="text-accent text-xs">GOOGLE_CLIENT_SECRET</code> in{" "}
              <code className="text-accent text-xs">.env.local</code>, then restart.
            </li>
          </ol>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-400 mt-2 mb-5">
            Sign in with Google to sync your email and calendar into Evolution OS.
          </p>
          <a href="/api/google/auth" className="btn-primary inline-flex">
            Connect Google account
          </a>
        </>
      )}
    </div>
  );
}
