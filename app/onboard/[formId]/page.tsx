"use client";

import { useEffect, useState } from "react";
import type { OnboardingForm, OnboardingField } from "@/lib/types";

/**
 * Public brand onboarding form. Renders a brand's form schema — including
 * multiselect, file upload, date, url, and CONDITIONAL fields (showIf) — and
 * submits it, creating a brand-scoped CRM lead with lead-source + campaign
 * attribution which then auto-generates the brand's missions. Standalone
 * (shareable link). Minimal UI.
 */
export default function OnboardPage({ params }: { params: { formId: string } }) {
  const [form, setForm] = useState<OnboardingForm | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [leadSource, setLeadSource] = useState("website");
  const [campaign, setCampaign] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "done" | "error">("loading");

  useEffect(() => {
    // Capture attribution from the link (e.g. ?source=instagram&campaign=spring).
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("source")) setLeadSource(q.get("source")!);
      if (q.get("campaign")) setCampaign(q.get("campaign")!);
    } catch {}
    fetch(`/api/onboarding/${params.formId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setForm(d.form); setState("ready"); } else setState("error"); })
      .catch(() => setState("error"));
  }, [params.formId]);

  const visible = (f: OnboardingField) => {
    if (!f.showIf) return true;
    const v = values[f.showIf.fieldId];
    if (Array.isArray(v)) return v.includes(f.showIf.equals);
    return String(v ?? "") === f.showIf.equals;
  };
  const set = (id: string, v: any) => setValues((prev) => ({ ...prev, [id]: v }));

  async function onFile(id: string, file: File | null) {
    if (!file) return set(id, "");
    if (file.size > 2_000_000) { set(id, `${file.name} (too large to attach — ${Math.round(file.size / 1024)}KB)`); return; }
    const reader = new FileReader();
    reader.onload = () => set(id, `${file.name}|${reader.result}`); // "name|dataUrl"
    reader.readAsDataURL(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(`/api/onboarding/${params.formId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: values, leadSource, campaign: campaign || undefined }),
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
        {form.fields.filter(visible).map((f) => (
          <label key={f.id} className="block">
            <span className="block text-sm text-slate-300 mb-1">{f.label}{f.required && <span className="text-pink-400"> *</span>}</span>
            {f.type === "textarea" ? (
              <textarea className="input min-h-[90px]" required={f.required} value={values[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} />
            ) : f.type === "select" ? (
              <select className="input" required={f.required} value={values[f.id] || ""} onChange={(e) => set(f.id, e.target.value)}>
                <option value="">Select…</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === "multiselect" ? (
              <div className="flex flex-wrap gap-2">
                {(f.options || []).map((o) => {
                  const sel = Array.isArray(values[f.id]) && values[f.id].includes(o);
                  return (
                    <button key={o} type="button"
                      onClick={() => { const cur: string[] = Array.isArray(values[f.id]) ? values[f.id] : []; set(f.id, sel ? cur.filter((x) => x !== o) : [...cur, o]); }}
                      className={`text-xs px-2.5 py-1 rounded-full border ${sel ? "bg-accent/20 border-accent/40 text-white" : "border-white/10 text-slate-300"}`}>
                      {o}
                    </button>
                  );
                })}
              </div>
            ) : f.type === "file" ? (
              <input className="input" type="file" onChange={(e) => onFile(f.id, e.target.files?.[0] || null)} />
            ) : f.type === "date" ? (
              <input className="input" type="date" required={f.required} value={values[f.id] || ""} onChange={(e) => set(f.id, e.target.value)} />
            ) : (
              <input
                className="input"
                type={f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "url" ? "url" : "text"}
                placeholder={f.placeholder}
                required={f.required}
                value={values[f.id] || ""}
                onChange={(e) => set(f.id, e.target.value)}
              />
            )}
          </label>
        ))}
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
