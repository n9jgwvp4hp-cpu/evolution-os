"use client";

import { useEffect, useState } from "react";
import type { OnboardingForm } from "@/lib/types";

/**
 * Public brand onboarding form. Renders a brand's form schema and submits it,
 * which creates a brand-scoped CRM lead with lead-source attribution. Standalone
 * (outside the app shell) so it can be shared as a link. Minimal UI for now.
 */
export default function OnboardPage({ params }: { params: { formId: string } }) {
  const [form, setForm] = useState<OnboardingForm | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [leadSource, setLeadSource] = useState("website");
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");

  useEffect(() => {
    fetch(`/api/onboarding/${params.formId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setForm(d.form); setState("ready"); } else setState("error"); })
      .catch(() => setState("error"));
  }, [params.formId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(`/api/onboarding/${params.formId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: values, leadSource }),
    });
    const j = await r.json();
    setState(j.ok ? "done" : "error");
  }

  if (state === "loading") return <Shell><p className="text-slate-500">Loading…</p></Shell>;
  if (state === "error" || !form) return <Shell><p className="text-slate-400">This form is unavailable.</p></Shell>;
  if (state === "done") return <Shell><h1 className="text-xl font-semibold text-white mb-2">Thank you!</h1><p className="text-slate-400">Your details were received. The team will follow up shortly.</p></Shell>;

  return (
    <Shell>
      <h1 className="text-xl font-semibold text-white mb-1">{form.title}</h1>
      {form.description && <p className="text-slate-400 text-sm mb-5">{form.description}</p>}
      <form onSubmit={submit} className="space-y-4">
        {form.fields.map((f) => (
          <label key={f.id} className="block">
            <span className="block text-sm text-slate-300 mb-1">{f.label}{f.required && <span className="text-pink-400"> *</span>}</span>
            {f.type === "textarea" ? (
              <textarea className="input min-h-[90px]" required={f.required} value={values[f.id] || ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })} />
            ) : f.type === "select" ? (
              <select className="input" required={f.required} value={values[f.id] || ""} onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}>
                <option value="">Select…</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="input"
                type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                required={f.required}
                value={values[f.id] || ""}
                onChange={(e) => setValues({ ...values, [f.id]: e.target.value })}
              />
            )}
          </label>
        ))}
        <label className="block">
          <span className="block text-sm text-slate-300 mb-1">Lead source</span>
          <select className="input" value={leadSource} onChange={(e) => setLeadSource(e.target.value)}>
            {["website", "instagram", "referral", "ads", "direct", "other"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-primary w-full">Submit</button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="glass p-6 sm:p-8 w-full max-w-lg">{children}</div>
    </div>
  );
}
