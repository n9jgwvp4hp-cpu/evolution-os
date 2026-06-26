"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  uid,
  formatMoney,
  type Deal,
  type DealStage,
  type Contact,
} from "@/lib/store";
import { useCollection } from "@/lib/collection";

const STAGES: { key: DealStage; label: string; color: string }[] = [
  { key: "lead", label: "Lead", color: "border-sky-500/40" },
  { key: "showing", label: "Showing", color: "border-amber-500/40" },
  { key: "offer", label: "Offer", color: "border-violet-500/40" },
  { key: "under_contract", label: "Under Contract", color: "border-cyan-500/40" },
  { key: "closed", label: "Closed", color: "border-emerald-500/40" },
  { key: "lost", label: "Lost", color: "border-pink-500/40" },
];

const blank = (): Deal => ({
  id: uid(),
  address: "",
  price: 0,
  side: "buy",
  stage: "lead",
  contactId: null,
  commission: 0,
  closeDate: "",
  notes: "",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export default function PipelinePage() {
  const [deals, setDeals, loaded] = useCollection<Deal>("deals", []);
  const [contacts] = useCollection<Contact>("contacts", []);
  const [draft, setDraft] = useState<Deal>(blank());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const active = deals.filter((d) => !["closed", "lost"].includes(d.stage));
    const pipelineValue = active.reduce((s, d) => s + (d.price || 0), 0);
    const expectedCommission = active.reduce((s, d) => s + (d.commission || 0), 0);
    const closedValue = deals
      .filter((d) => d.stage === "closed")
      .reduce((s, d) => s + (d.commission || 0), 0);
    return { active: active.length, pipelineValue, expectedCommission, closedValue };
  }, [deals]);

  function save() {
    if (!draft.address.trim()) return;
    const exists = deals.some((d) => d.id === draft.id);
    const next = { ...draft, updatedAt: Date.now() };
    setDeals(exists ? deals.map((d) => (d.id === draft.id ? next : d)) : [next, ...deals]);
    setDraft(blank());
    setShowForm(false);
    setEditingId(null);
  }
  function move(id: string, stage: DealStage) {
    setDeals(deals.map((d) => (d.id === id ? { ...d, stage, updatedAt: Date.now() } : d)));
  }
  function remove(id: string) {
    setDeals(deals.filter((d) => d.id !== id));
  }
  function edit(d: Deal) {
    setDraft(d);
    setEditingId(d.id);
    setShowForm(true);
  }
  const contactName = (id: string | null) =>
    contacts.find((c) => c.id === id)?.name ?? null;

  return (
    <div className="max-w-[1400px] mx-auto">
      <PageHeader
        title="Property Pipeline"
        subtitle="Track every deal from lead to close."
        action={
          <button className="btn-primary" onClick={() => { setDraft(blank()); setEditingId(null); setShowForm((v) => !v); }}>
            {showForm ? "Close" : "+ New deal"}
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Active deals" value={String(stats.active)} />
        <Stat label="Pipeline value" value={formatMoney(stats.pipelineValue)} />
        <Stat label="Expected commission" value={formatMoney(stats.expectedCommission)} />
        <Stat label="Closed commission" value={formatMoney(stats.closedValue)} />
      </div>

      {showForm && (
        <div className="glass p-5 mb-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-floatUp">
          <input className="input lg:col-span-2" placeholder="Property address *" value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          <select className="input" value={draft.side}
            onChange={(e) => setDraft({ ...draft, side: e.target.value as Deal["side"] })}>
            <option value="buy">Representing Buyer</option>
            <option value="sell">Representing Seller</option>
          </select>
          <input className="input" type="number" placeholder="List / sale price ($)" value={draft.price || ""}
            onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })} />
          <input className="input" type="number" placeholder="Expected commission ($)" value={draft.commission || ""}
            onChange={(e) => setDraft({ ...draft, commission: Number(e.target.value) })} />
          <input className="input" type="date" value={draft.closeDate}
            onChange={(e) => setDraft({ ...draft, closeDate: e.target.value })} />
          <select className="input" value={draft.stage}
            onChange={(e) => setDraft({ ...draft, stage: e.target.value as DealStage })}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select className="input" value={draft.contactId ?? ""}
            onChange={(e) => setDraft({ ...draft, contactId: e.target.value || null })}>
            <option value="">— Link a contact —</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input className="input lg:col-span-3" placeholder="Notes" value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="flex gap-2">
            <button className="btn-primary" onClick={save}>{editingId ? "Save" : "Add deal"}</button>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setDraft(blank()); }}>Cancel</button>
          </div>
        </div>
      )}

      {loaded && deals.length === 0 && !showForm && (
        <div className="glass p-10 text-center text-slate-500">
          No deals yet. Add your first property to start tracking your pipeline.
        </div>
      )}

      {/* Kanban */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {STAGES.map((stage) => {
          const items = deals.filter((d) => d.stage === stage.key);
          return (
            <div key={stage.key} className={`glass p-3 border-t-2 ${stage.color}`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-white">{stage.label}</span>
                <span className="text-xs text-slate-500">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((d) => (
                  <div key={d.id} className="rounded-xl bg-black/30 border border-white/10 p-3 text-sm">
                    <div className="font-medium text-slate-100 leading-tight">{d.address}</div>
                    <div className="text-xs text-slate-500 mt-0.5 capitalize">
                      {d.side === "buy" ? "Buyer side" : "Seller side"}
                      {contactName(d.contactId) ? ` · ${contactName(d.contactId)}` : ""}
                    </div>
                    {d.price > 0 && <div className="text-xs text-accent mt-1">{formatMoney(d.price)}</div>}
                    {d.closeDate && <div className="text-[11px] text-slate-500">Close: {d.closeDate}</div>}
                    {d.notes && <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{d.notes}</p>}

                    <div className="flex items-center gap-2 mt-2">
                      <select
                        className="flex-1 bg-transparent text-[11px] text-slate-400 outline-none"
                        value={d.stage}
                        onChange={(e) => move(d.id, e.target.value as DealStage)}
                      >
                        {STAGES.map((s) => <option key={s.key} value={s.key} className="bg-surface">{s.label}</option>)}
                      </select>
                      <button onClick={() => edit(d)} className="text-[11px] text-slate-500 hover:text-accent">Edit</button>
                      <button onClick={() => remove(d.id)} className="text-slate-600 hover:text-pink-400">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}
