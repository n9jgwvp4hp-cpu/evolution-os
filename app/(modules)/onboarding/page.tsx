"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useBrand } from "@/components/BrandContext";
import { uid, type OnboardingForm, type OnboardingField, type OnboardingFieldType } from "@/lib/store";

/**
 * No-code onboarding form builder (Phase 2 #1). Create/edit a brand's onboarding
 * flow: add fields of any type (text, dropdown, multiselect, file, date, phone,
 * url, …), mark required, set options, map to CRM fields, and add conditional
 * (showIf) logic. Functional, minimal UI.
 */
const TYPES: OnboardingFieldType[] = ["text", "email", "phone", "url", "textarea", "select", "multiselect", "file", "date", "number"];
const MAPS = ["", "name", "email", "phone", "company", "budget", "notes"];

export default function OnboardingBuilderPage() {
  const { activeBrand, isParentActive, brands } = useBrand();
  const brandId = activeBrand?.id;
  const [forms, setForms] = useState<OnboardingForm[]>([]);
  const [selId, setSelId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!brandId) return;
    fetch(`/api/onboarding?brandId=${brandId}`, { cache: "no-store" }).then((r) => r.json()).then((d) => {
      setForms(d.forms || []);
      setSelId((prev) => prev && (d.forms || []).some((f: OnboardingForm) => f.id === prev) ? prev : (d.forms?.[0]?.id ?? null));
    });
  }, [brandId]);
  useEffect(() => { load(); }, [load]);

  const form = useMemo(() => forms.find((f) => f.id === selId) || null, [forms, selId]);

  async function createForm() {
    const r = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brandId, title: `${activeBrand?.name} — New form`, fields: [] }) });
    const j = await r.json();
    await load();
    if (j.form) setSelId(j.form.id);
  }
  async function saveForm(next: OnboardingForm) {
    setForms((prev) => prev.map((f) => (f.id === next.id ? next : f)));
    await fetch(`/api/onboarding/${next.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: next.title, description: next.description, status: next.status, fields: next.fields }) });
  }
  async function delForm(id: string) {
    if (!confirm("Delete this form?")) return;
    await fetch(`/api/onboarding/${id}`, { method: "DELETE" });
    load();
  }

  if (isParentActive) return <Wrap><div className="glass p-8 text-slate-400">Select a subsidiary brand in the switcher to edit its onboarding form.</div></Wrap>;

  return (
    <Wrap>
      <div className="flex items-center gap-2 mb-4">
        <select className="input max-w-xs" value={selId || ""} onChange={(e) => setSelId(e.target.value)}>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
        <button onClick={createForm} className="btn-primary text-sm">+ New form</button>
        {form && <button onClick={() => delForm(form.id)} className="text-sm text-pink-400/80 hover:text-pink-400 ml-auto">Delete</button>}
        {form && <a href={`/onboard/${form.id}`} target="_blank" className="text-sm text-slate-300 hover:text-white">Preview ↗</a>}
      </div>

      {!form ? <div className="glass p-8 text-slate-500">No form selected.</div> : (
        <div className="space-y-4">
          <div className="glass p-4 space-y-3">
            <input className="input" value={form.title} onChange={(e) => saveForm({ ...form, title: e.target.value })} placeholder="Form title" />
            <input className="input" value={form.description || ""} onChange={(e) => saveForm({ ...form, description: e.target.value })} placeholder="Description" />
          </div>

          <div className="space-y-2">
            {form.fields.map((fld, i) => (
              <FieldRow key={fld.id} field={fld} allFields={form.fields}
                onChange={(nf) => saveForm({ ...form, fields: form.fields.map((x) => (x.id === fld.id ? nf : x)) })}
                onRemove={() => saveForm({ ...form, fields: form.fields.filter((x) => x.id !== fld.id) })}
                onUp={() => i > 0 && saveForm({ ...form, fields: swap(form.fields, i, i - 1) })}
                onDown={() => i < form.fields.length - 1 && saveForm({ ...form, fields: swap(form.fields, i, i + 1) })}
              />
            ))}
          </div>

          <button
            onClick={() => saveForm({ ...form, fields: [...form.fields, { id: uid(), label: "New field", type: "text", required: false }] })}
            className="btn-primary text-sm"
          >+ Add field</button>
        </div>
      )}
    </Wrap>
  );
}

function FieldRow({ field, allFields, onChange, onRemove, onUp, onDown }: {
  field: OnboardingField; allFields: OnboardingField[];
  onChange: (f: OnboardingField) => void; onRemove: () => void; onUp: () => void; onDown: () => void;
}) {
  const needsOptions = field.type === "select" || field.type === "multiselect";
  return (
    <div className="glass p-3 grid gap-2 sm:grid-cols-[1fr_130px_90px_120px_auto]">
      <input className="input" value={field.label} onChange={(e) => onChange({ ...field, label: e.target.value })} placeholder="Label" />
      <select className="input" value={field.type} onChange={(e) => onChange({ ...field, type: e.target.value as OnboardingFieldType })}>
        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-xs text-slate-400 px-1"><input type="checkbox" checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} /> req</label>
      <select className="input text-xs" value={field.mapsTo || ""} onChange={(e) => onChange({ ...field, mapsTo: (e.target.value || undefined) as any })}>
        {MAPS.map((m) => <option key={m} value={m}>{m ? `→ ${m}` : "no map"}</option>)}
      </select>
      <div className="flex items-center gap-1">
        <button onClick={onUp} className="text-slate-500 hover:text-white px-1">↑</button>
        <button onClick={onDown} className="text-slate-500 hover:text-white px-1">↓</button>
        <button onClick={onRemove} className="text-pink-400/70 hover:text-pink-400 px-1">✕</button>
      </div>
      {needsOptions && (
        <input className="input sm:col-span-5 text-xs" placeholder="Options (comma-separated)"
          value={(field.options || []).join(", ")}
          onChange={(e) => onChange({ ...field, options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
      )}
      <div className="sm:col-span-5 flex items-center gap-2 text-xs text-slate-500">
        <span>Show only if</span>
        <select className="input text-xs max-w-[160px]" value={field.showIf?.fieldId || ""} onChange={(e) => onChange({ ...field, showIf: e.target.value ? { fieldId: e.target.value, equals: field.showIf?.equals || "" } : undefined })}>
          <option value="">(always)</option>
          {allFields.filter((f) => f.id !== field.id).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        {field.showIf && <input className="input text-xs max-w-[140px]" placeholder="equals…" value={field.showIf.equals} onChange={(e) => onChange({ ...field, showIf: { fieldId: field.showIf!.fieldId, equals: e.target.value } })} />}
      </div>
    </div>
  );
}

const swap = <T,>(arr: T[], i: number, j: number) => { const c = [...arr]; [c[i], c[j]] = [c[j], c[i]]; return c; };

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="max-w-4xl mx-auto pb-16"><PageHeader title="Onboarding Builder" subtitle="Design each brand's intake flow — no code" />{children}</div>;
}
