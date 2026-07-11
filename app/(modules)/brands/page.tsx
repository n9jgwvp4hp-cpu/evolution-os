"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useBrand } from "@/components/BrandContext";
import type { Brand, OnboardingForm } from "@/lib/types";

/**
 * Brands admin (functional, minimal UI). Manage the portfolio: create brands,
 * edit their profile (domain, Instagram/email accounts, services, colors, lead
 * sources), and see each brand's onboarding form link. Architecture-first — the
 * fields map 1:1 to the Brand model.
 */
type Conn = { brandId: string; connected: boolean; email: string | null; effective: string; effectiveEmail: string | null };

export default function BrandsPage() {
  const { brands, reload, setActiveBrandId } = useBrand();
  const [forms, setForms] = useState<OnboardingForm[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [newName, setNewName] = useState("");

  const loadForms = () => fetch("/api/onboarding", { cache: "no-store" }).then((r) => r.json()).then((d) => setForms(d.forms || []));
  const loadConns = () => fetch("/api/brands/connections", { cache: "no-store" }).then((r) => r.json()).then((d) => setConns(d.connections || []));
  useEffect(() => { loadForms(); loadConns(); }, []);

  async function createBrand(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await fetch("/api/brands", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim() }) });
    setNewName("");
    await reload();
    await loadForms();
  }

  const rank = (b: Brand) => (b.kind === "holding" ? 0 : b.kind === "personal" ? 2 : 1);

  return (
    <div className="max-w-5xl mx-auto pb-16">
      <PageHeader title="Brand Settings" subtitle="Account types, profiles, and each brand's own Gmail + Calendar connection" />

      <form onSubmit={createBrand} className="glass p-4 mb-6 flex gap-3">
        <input className="input flex-1" placeholder="New business brand name (e.g. Prism44)" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn-primary" type="submit">+ Add brand</button>
      </form>

      <div className="grid gap-4">
        {[...brands].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).map((b) => (
          <BrandCard key={b.id} brand={b} conn={conns.find((c) => c.brandId === b.id)} forms={forms.filter((f) => f.brandId === b.id)} onSaved={() => { reload(); loadForms(); loadConns(); }} onFocus={() => setActiveBrandId(b.id)} />
        ))}
      </div>
    </div>
  );
}

const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  personal: { label: "Personal", cls: "bg-slate-500/20 text-slate-300" },
  holding: { label: "Parent · Portfolio", cls: "bg-accent/20 text-accent" },
  brand: { label: "Business Brand", cls: "bg-violet-500/20 text-violet-300" },
};

function BrandCard({ brand, conn, forms, onSaved, onFocus }: { brand: Brand; conn?: Conn; forms: OnboardingForm[]; onSaved: () => void; onFocus: () => void }) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Brand>(brand);
  useEffect(() => setDraft(brand), [brand]);

  async function disconnect() {
    await fetch(`/api/google/disconnect?brandId=${brand.id}`, { method: "POST" });
    onSaved();
  }

  async function save() {
    await fetch(`/api/brands/${brand.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: draft.domain,
        instagramAccounts: draft.instagramAccounts,
        emailAccounts: draft.emailAccounts,
        services: draft.services,
        colors: draft.colors,
        leadSources: draft.leadSources,
      }),
    });
    setEdit(false);
    onSaved();
  }
  async function del() {
    if (!confirm(`Delete ${brand.name}? Its data is preserved but unlinked.`)) return;
    const r = await fetch(`/api/brands/${brand.id}`, { method: "DELETE" });
    const j = await r.json();
    if (!j.ok) alert(j.error || "Could not delete");
    onSaved();
  }
  const list = (v: string[]) => (v || []).join(", ");
  const setList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2.5">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: brand.colors?.primary }} />
        <h3 className="font-semibold text-white">{brand.name}</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${(KIND_BADGE[brand.kind] || KIND_BADGE.brand).cls}`}>{(KIND_BADGE[brand.kind] || KIND_BADGE.brand).label}</span>
        <span className="ml-auto flex gap-2">
          <button onClick={onFocus} className="text-xs text-slate-400 hover:text-white">Focus</button>
          <button onClick={() => setEdit((v) => !v)} className="text-xs text-slate-400 hover:text-white">{edit ? "Cancel" : "Edit"}</button>
          {brand.kind === "brand" && <button onClick={del} className="text-xs text-pink-400/80 hover:text-pink-400">Delete</button>}
        </span>
      </div>

      {/* Gmail + Calendar connection (each brand connects its own, later). */}
      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${conn?.connected ? "bg-emerald-400" : conn?.effective === "parent" ? "bg-amber-400/70" : "bg-slate-600"}`} />
          <span className="text-sm text-slate-200">Gmail + Calendar</span>
          <span className="text-xs text-slate-500 ml-1">
            {conn?.connected
              ? `Connected as ${conn.email || "its own account"}`
              : brand.kind === "personal"
                ? (conn?.effective === "brand" ? "" : "Not connected — personal account, kept separate from business")
                : conn?.effective === "parent"
                  ? `Using UW Equity (${conn.effectiveEmail || "portfolio"}) until connected`
                  : "Not connected"}
          </span>
          <span className="ml-auto flex gap-2">
            <a href={`/api/google/auth?brandId=${brand.id}`} className="text-xs btn-primary py-1 px-2.5">{conn?.connected ? "Reconnect" : "Connect"}</a>
            {conn?.connected && <button onClick={disconnect} className="text-xs text-slate-400 hover:text-white">Disconnect</button>}
          </span>
        </div>
      </div>

      {!edit ? (
        <div className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-slate-400">
          <Field label="Domain" value={brand.domain || "—"} />
          <Field label="Services" value={list(brand.services) || "—"} />
          <Field label="Instagram" value={list(brand.instagramAccounts) || "—"} />
          <Field label="Email" value={list(brand.emailAccounts) || "—"} />
          <Field label="Lead sources" value={list(brand.leadSources)} />
          <Field label="Onboarding" value={forms.length ? forms.map((f) => f.title).join(", ") : "—"} />
        </div>
      ) : (
        <div className="mt-3 grid sm:grid-cols-2 gap-3">
          <L label="Domain"><input className="input" value={draft.domain || ""} onChange={(e) => setDraft({ ...draft, domain: e.target.value })} /></L>
          <L label="Services (comma-sep)"><input className="input" value={list(draft.services)} onChange={(e) => setDraft({ ...draft, services: setList(e.target.value) })} /></L>
          <L label="Instagram (comma-sep)"><input className="input" value={list(draft.instagramAccounts)} onChange={(e) => setDraft({ ...draft, instagramAccounts: setList(e.target.value) })} /></L>
          <L label="Email accounts (comma-sep)"><input className="input" value={list(draft.emailAccounts)} onChange={(e) => setDraft({ ...draft, emailAccounts: setList(e.target.value) })} /></L>
          <L label="Lead sources (comma-sep)"><input className="input" value={list(draft.leadSources)} onChange={(e) => setDraft({ ...draft, leadSources: setList(e.target.value) as any })} /></L>
          <L label="Primary color"><input className="input" value={draft.colors?.primary || ""} onChange={(e) => setDraft({ ...draft, colors: { ...draft.colors, primary: e.target.value } })} /></L>
          <div className="sm:col-span-2"><button onClick={save} className="btn-primary">Save</button></div>
        </div>
      )}

      {forms.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {forms.map((f) => (
            <a key={f.id} href={`/onboard/${f.id}`} target="_blank" className="text-xs px-2.5 py-1 rounded-full border border-white/10 text-slate-300 hover:bg-white/5">
              Onboarding form ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div><span className="text-slate-600">{label}: </span><span className="text-slate-300">{value}</span></div>;
}
function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">{label}</span>{children}</label>;
}
