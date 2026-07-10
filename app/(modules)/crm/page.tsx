"use client";

import { useMemo, useState } from "react";
import PageHeader from "@/components/PageHeader";
import {
  uid,
  timeAgo,
  formatMoney,
  type Contact,
  type LeadStatus,
} from "@/lib/store";
import { useCollection } from "@/lib/collection";
import { useBrand } from "@/components/BrandContext";

const STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "nurturing",
  "client",
  "closed",
  "lost",
];

const STATUS_STYLE: Record<LeadStatus, string> = {
  new: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  contacted: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  qualified: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  nurturing: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  client: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closed: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  lost: "bg-pink-500/15 text-pink-300 border-pink-500/30",
};

const blank = (): Contact => ({
  id: uid(),
  name: "",
  email: "",
  phone: "",
  type: "buyer",
  status: "new",
  source: "",
  budget: 0,
  notes: "",
  lastTouch: Date.now(),
  createdAt: Date.now(),
});

export default function CrmPage() {
  const [contacts, setContacts, loaded] = useCollection<Contact>("contacts", []);
  const { activeBrand, isParentActive } = useBrand();
  const [draft, setDraft] = useState<Contact>(blank());
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Separate CRM pipelines by brand: the parent (UW Equity) sees every lead; a
  // subsidiary sees only its own. Mutations still run against the full list.
  const scoped = useMemo(
    () => (isParentActive || !activeBrand ? contacts : contacts.filter((c) => c.brandId === activeBrand.id)),
    [contacts, activeBrand, isParentActive]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped
      .filter((c) => (statusFilter === "all" ? true : c.status === statusFilter))
      .filter((c) =>
        q
          ? [c.name, c.email, c.phone, c.source, c.notes]
              .join(" ")
              .toLowerCase()
              .includes(q)
          : true
      );
  }, [scoped, query, statusFilter]);

  function save() {
    if (!draft.name.trim()) return;
    const exists = contacts.some((c) => c.id === draft.id);
    if (exists) {
      setContacts(contacts.map((c) => (c.id === draft.id ? draft : c)));
    } else {
      // New leads join the active brand's pipeline (unassigned when the parent is active).
      const withBrand = { ...draft, brandId: isParentActive ? draft.brandId ?? null : activeBrand?.id ?? null };
      setContacts([withBrand, ...contacts]);
    }
    setDraft(blank());
    setShowForm(false);
    setEditingId(null);
  }

  function patch(id: string, p: Partial<Contact>) {
    setContacts(contacts.map((c) => (c.id === id ? { ...c, ...p } : c)));
  }
  function remove(id: string) {
    setContacts(contacts.filter((c) => c.id !== id));
  }
  function edit(c: Contact) {
    setDraft(c);
    setShowForm(true);
    setEditingId(c.id);
  }

  const counts = STATUSES.map((s) => scoped.filter((c) => c.status === s).length);

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title="CRM · Leads"
        subtitle={`${activeBrand && !isParentActive ? activeBrand.name + " · " : ""}${scoped.length} contacts · ${
          scoped.filter((c) => !["closed", "lost"].includes(c.status)).length
        } active`}
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setDraft(blank());
              setEditingId(null);
              setShowForm((v) => !v);
            }}
          >
            {showForm ? "Close" : "+ New lead"}
          </button>
        }
      />

      {showForm && (
        <div className="glass p-5 mb-5 grid sm:grid-cols-2 gap-3 animate-floatUp">
          <input className="input" placeholder="Full name *" value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input" placeholder="Phone" value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <input className="input" placeholder="Email" value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <input className="input" placeholder="Source (Zillow, referral…)" value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
          <select className="input" value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as Contact["type"] })}>
            <option value="buyer">Buyer</option>
            <option value="seller">Seller</option>
            <option value="investor">Investor</option>
            <option value="renter">Renter</option>
            <option value="other">Other</option>
          </select>
          <select className="input" value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as LeadStatus })}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="input" type="number" placeholder="Budget ($)" value={draft.budget || ""}
            onChange={(e) => setDraft({ ...draft, budget: Number(e.target.value) })} />
          <input className="input" placeholder="Notes" value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="sm:col-span-2 flex gap-2">
            <button className="btn-primary" onClick={save}>
              {editingId ? "Save changes" : "Add lead"}
            </button>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setDraft(blank()); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search + status filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="input flex-1 min-w-[180px]"
          placeholder="Search leads…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <Chip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
          All · {contacts.length}
        </Chip>
        {STATUSES.map((s, i) => (
          <Chip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s} · {counts[i]}
          </Chip>
        ))}
      </div>

      {loaded && filtered.length === 0 && (
        <div className="glass p-10 text-center text-slate-500">
          No leads {query || statusFilter !== "all" ? "match your filter" : "yet"}.
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => (
          <div key={c.id} className="card flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-white truncate">{c.name}</div>
                <div className="text-xs text-slate-500 capitalize">
                  {c.type} · {c.source || "no source"}
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border capitalize shrink-0 ${STATUS_STYLE[c.status]}`}>
                {c.status}
              </span>
            </div>

            {(c.phone || c.email) && (
              <div className="flex flex-wrap gap-2 text-xs">
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="btn-ghost !px-2.5 !py-1 text-xs"
                     onClick={() => patch(c.id, { lastTouch: Date.now() })}>📞 Call</a>
                )}
                {c.phone && (
                  <a href={`sms:${c.phone}`} className="btn-ghost !px-2.5 !py-1 text-xs"
                     onClick={() => patch(c.id, { lastTouch: Date.now() })}>💬 Text</a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="btn-ghost !px-2.5 !py-1 text-xs"
                     onClick={() => patch(c.id, { lastTouch: Date.now() })}>✉️ Email</a>
                )}
              </div>
            )}

            {c.budget > 0 && (
              <div className="text-sm text-slate-300">Budget: {formatMoney(c.budget)}</div>
            )}
            {c.notes && <p className="text-xs text-slate-400 line-clamp-2">{c.notes}</p>}

            <div className="mt-auto flex items-center justify-between pt-2 border-t border-white/5">
              <select
                className="bg-transparent text-xs text-slate-400 outline-none capitalize"
                value={c.status}
                onChange={(e) => patch(c.id, { status: e.target.value as LeadStatus, lastTouch: Date.now() })}
              >
                {STATUSES.map((s) => <option key={s} value={s} className="bg-surface">{s}</option>)}
              </select>
              <div className="flex items-center gap-2 text-slate-600">
                <span className="text-[10px]">{timeAgo(c.lastTouch)}</span>
                <button onClick={() => edit(c)} className="hover:text-accent text-xs">Edit</button>
                <button onClick={() => remove(c.id)} className="hover:text-pink-400">✕</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border capitalize transition ${
        active ? "bg-accent/15 border-accent/40 text-accent" : "border-white/10 text-slate-400 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
