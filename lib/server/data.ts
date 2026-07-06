import { mutate, read, uid } from "@/lib/server/db";
import type { Task, Contact, Deal, Note, Memory, LeadStatus, DealStage, BrainKind } from "@/lib/types";

/**
 * The brain's write/read operations — one source of truth for every entity.
 *
 * Both Conversation Mode (via /api/tools) and Mission Mode (via the server
 * tool registry) call these, and the module views read the same collections
 * through /api/data. There is exactly one persistent brain.
 */

const KINDS: BrainKind[] = ["tasks", "contacts", "deals", "notes", "memories"];
export function isBrainKind(k: string): k is BrainKind {
  return (KINDS as string[]).includes(k);
}

/* ---- generic collection access (module views) ---- */
export async function listKind(kind: BrainKind) {
  return read((db) => db[kind] as any[]);
}
export async function replaceKind(kind: BrainKind, items: any[]) {
  await mutate((db) => {
    (db as any)[kind] = Array.isArray(items) ? items : [];
  });
  return { ok: true, count: items.length };
}

/* ---- semantic capabilities (conversation + missions) ---- */
export async function createTask(a: any) {
  // Idempotent by open-title: never create a second OPEN task with the same
  // title. This makes repeated work safe — the recurring kernel briefing (which
  // runs every few hours) can propose "Reply to X" every time without piling up
  // duplicates, regardless of whether the model remembers to check first.
  const title = String(a.title);
  let existed = false;
  await mutate((db) => {
    const dup = db.tasks.find((t) => !t.done && t.title.trim().toLowerCase() === title.trim().toLowerCase());
    if (dup) { existed = true; return; }
    db.tasks.unshift({
      id: uid(),
      title,
      done: false,
      priority: (a.priority as Task["priority"]) || "medium",
      createdAt: Date.now(),
    });
  });
  return existed
    ? { ok: true, existing: title, note: "An open task with this title already exists — not duplicated." }
    : { ok: true, created: title };
}

export async function completeTask(a: any) {
  const q = String(a.title || "").toLowerCase();
  let matched: string | null = null;
  await mutate((db) => {
    const t = db.tasks.find((x) => !x.done && x.title.toLowerCase().includes(q));
    if (t) { t.done = true; matched = t.title; }
  });
  return matched ? { ok: true, completed: matched } : { ok: false, error: "No matching open task found." };
}

export async function addContact(a: any) {
  // Upsert by name: idempotent CRM. If the person already exists, UPDATE the
  // provided fields and touch lastTouch (so the recurring kernel can keep records
  // current every run without creating duplicates); otherwise create them.
  const name = String(a.name);
  let updated = false;
  await mutate((db) => {
    const ex = db.contacts.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (ex) {
      if (a.email) ex.email = a.email;
      if (a.phone) ex.phone = a.phone;
      if (a.type) ex.type = a.type as Contact["type"];
      if (a.status) ex.status = a.status as LeadStatus;
      if (a.source) ex.source = a.source;
      if (a.budget != null && Number(a.budget)) ex.budget = Number(a.budget);
      if (a.notes) ex.notes = a.notes;
      ex.lastTouch = Date.now();
      updated = true;
    } else {
      db.contacts.unshift({
        id: uid(), name, email: a.email || "", phone: a.phone || "",
        type: (a.type as Contact["type"]) || "other",
        status: (a.status as LeadStatus) || "new",
        source: a.source || "", budget: Number(a.budget) || 0, notes: a.notes || "",
        lastTouch: Date.now(), createdAt: Date.now(),
      });
    }
  });
  return updated ? { ok: true, updated: name } : { ok: true, created: name };
}

export async function createDeal(a: any) {
  let linkedName: string | null = null;
  const deal: Deal = {
    id: uid(),
    address: String(a.address),
    price: Number(a.price) || 0,
    side: (a.side as Deal["side"]) || "buy",
    stage: (a.stage as DealStage) || "lead",
    contactId: null,
    commission: Number(a.commission) || 0,
    closeDate: a.closeDate || "",
    notes: a.notes || "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await mutate((db) => {
    if (a.contactName) {
      const c = db.contacts.find((x) => x.name.toLowerCase().includes(String(a.contactName).toLowerCase()));
      if (c) { deal.contactId = c.id; linkedName = c.name; }
    }
    db.deals.unshift(deal);
  });
  return { ok: true, created: deal.address, linkedContact: linkedName };
}

export async function updateDealStage(a: any) {
  const q = String(a.address || "").toLowerCase();
  let matched: string | null = null;
  await mutate((db) => {
    const d = db.deals.find((x) => x.address.toLowerCase().includes(q));
    if (d) { d.stage = a.stage as DealStage; d.updatedAt = Date.now(); matched = d.address; }
  });
  return matched ? { ok: true, deal: matched, stage: a.stage } : { ok: false, error: "No matching deal found." };
}

export async function saveMemory(a: any) {
  // Idempotent by text: never store the same fact twice, so the recurring kernel
  // doesn't accumulate duplicate memories every run.
  const text = String(a.text);
  let existed = false;
  await mutate((db) => {
    if (db.memories.some((m) => m.text.trim().toLowerCase() === text.trim().toLowerCase())) { existed = true; return; }
    db.memories.unshift({
      id: uid(), text,
      category: (a.category as Memory["category"]) || "fact",
      pinned: false, createdAt: Date.now(),
    });
  });
  return existed ? { ok: true, existing: text } : { ok: true, remembered: text };
}

export async function forgetMemory(a: any) {
  const q = String(a.query || "").toLowerCase();
  let removed: string | null = null;
  await mutate((db) => {
    const m = db.memories.find((x) => x.text.toLowerCase().includes(q));
    if (m) { db.memories = db.memories.filter((x) => x.id !== m.id); removed = m.text; }
  });
  return removed ? { ok: true, forgot: removed } : { ok: false, error: "No matching memory found." };
}

export async function createNote(a: any) {
  // Upsert by title: re-saving "the report" updates it instead of creating
  // duplicates (e.g. when a quality-control pass revises the content).
  const title = String(a.title);
  const body = a.body || "";
  let updated = false;
  await mutate((db) => {
    const existing = db.notes.find((n) => n.title.toLowerCase() === title.toLowerCase());
    if (existing) {
      existing.body = body || existing.body;
      existing.updatedAt = Date.now();
      updated = true;
    } else {
      db.notes.unshift({ id: uid(), title, body, updatedAt: Date.now() });
    }
  });
  return { ok: true, [updated ? "updated" : "created"]: title };
}

export async function searchData(a: any) {
  const q = String(a.query || "").toLowerCase();
  const hit = (s: string) => s.toLowerCase().includes(q);
  return read((db) => ({
    ok: true,
    contacts: db.contacts.filter((c) => hit(c.name) || hit(c.email) || hit(c.phone) || hit(c.notes) || hit(c.source)).slice(0, 10),
    deals: db.deals.filter((d) => hit(d.address) || hit(d.notes)).slice(0, 10),
    tasks: db.tasks.filter((t) => hit(t.title)).slice(0, 10).map((t) => t.title),
    notes: db.notes.filter((n) => hit(n.title) || hit(n.body)).slice(0, 5).map((n) => ({ title: n.title, body: n.body.slice(0, 200) })),
    memories: db.memories.filter((m) => hit(m.text)).slice(0, 10).map((m) => m.text),
  }));
}

/** Compact knowledge block injected into both conversation and missions. */
export async function buildBrainContext(): Promise<string> {
  return read((db) => {
    const money = (n: number) => (n ? "$" + n.toLocaleString() : "—");
    const parts: string[] = [];

    if (db.memories.length) {
      const sorted = [...db.memories].sort((a, b) => Number(b.pinned) - Number(a.pinned));
      parts.push("## Long-term memory\n" + sorted.slice(0, 40).map((m) => `- ${m.text}`).join("\n"));
    }
    const openDeals = db.deals.filter((d) => !["closed", "lost"].includes(d.stage));
    if (openDeals.length) {
      parts.push("## Active deals\n" + openDeals.slice(0, 20).map((d) =>
        `- ${d.address} · ${d.side} · ${d.stage.replace("_", " ")} · ${money(d.price)}`).join("\n"));
    }
    const leads = db.contacts.filter((c) => !["closed", "lost"].includes(c.status));
    if (leads.length) {
      parts.push("## Contacts & leads\n" + leads.slice(0, 25).map((c) =>
        `- ${c.name} (${c.type}, ${c.status})${c.phone ? ` · ${c.phone}` : ""}${c.budget ? ` · budget ${money(c.budget)}` : ""}`).join("\n"));
    }
    const open = db.tasks.filter((t) => !t.done);
    if (open.length) {
      parts.push("## Open tasks\n" + open.slice(0, 20).map((t) => `- [${t.priority}] ${t.title}`).join("\n"));
    }
    if (db.notes.length) {
      parts.push("## Recent notes\n" + db.notes.slice(0, 8).map((n) => `- ${n.title}: ${n.body.slice(0, 120)}`).join("\n"));
    }
    return parts.join("\n\n");
  });
}
