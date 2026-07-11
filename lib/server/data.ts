import { mutate, read, uid } from "@/lib/server/db";
import type { Task, Contact, Deal, Note, Memory, Priority, LeadStatus, DealStage, BrainKind, Objective } from "@/lib/types";

/**
 * The brain's write/read operations — one source of truth for every entity.
 *
 * Both Conversation Mode (via /api/tools) and Mission Mode (via the server
 * tool registry) call these, and the module views read the same collections
 * through /api/data. There is exactly one persistent brain.
 */

const KINDS: BrainKind[] = ["tasks", "projects", "contacts", "deals", "notes", "memories", "priorities"];
export function isBrainKind(k: string): k is BrainKind {
  return (KINDS as string[]).includes(k);
}

/**
 * Rebuild the unified Priority Queue from ranked items the kernel produced.
 * Ranking is DETERMINISTIC and explainable: score is derived from importance,
 * urgency, deadline proximity, and whether the item is blocked by a dependency —
 * not from the model's own ordering. Replaces the queue each cycle (idempotent;
 * always reflects the latest analysis). Every item must carry a `why`.
 */
/** Deterministic score + normalization for one recommendation. Shared by the
 *  global queue and per-objective planning so ranking is identical everywhere. */
function toPriority(it: any, fallbackObjectiveId: string | null = null): Priority {
  const clamp = (n: any) => Math.max(1, Math.min(5, Math.round(Number(n) || 3)));
  const deadlineBoost = (iso?: string): number => {
    if (!iso) return 0;
    const t = Date.parse(iso);
    if (isNaN(t)) return 0;
    const days = (t - Date.now()) / 86_400_000;
    if (days < 0) return 40;   // overdue
    if (days <= 1) return 30;  // today / tomorrow
    if (days <= 3) return 20;
    if (days <= 7) return 10;
    return 5;
  };
  const now = Date.now();
  const urgency = clamp(it.urgency);
  const importance = clamp(it.importance);
  const blocked = Boolean(it.dependsOn && String(it.dependsOn).trim());
  const score = importance * 20 + urgency * 20 + deadlineBoost(it.deadline) - (blocked ? 15 : 0);
  return {
    id: uid(),
    objectiveId: it.objectiveId ? String(it.objectiveId) : fallbackObjectiveId, // ladder each recommendation to its objective
    title: String(it.title).slice(0, 200),
    category: (["email", "calendar", "crm", "mission", "task", "other"].includes(it.category) ? it.category : "other") as Priority["category"],
    urgency, importance,
    deadline: it.deadline ? String(it.deadline) : undefined,
    dependsOn: blocked ? String(it.dependsOn) : undefined,
    score,
    recommendedAction: String(it.recommendedAction || "").slice(0, 300),
    why: String(it.why).slice(0, 400),
    source: String(it.source || "").slice(0, 120),
    createdAt: now, updatedAt: now,
  };
}

export async function setPriorities(a: any) {
  const items: Priority[] = (Array.isArray(a.items) ? a.items : [])
    .filter((it: any) => it && it.title && it.why) // a recommendation MUST explain why
    .slice(0, 25)
    .map((it: any) => toPriority(it))
    .sort((x: Priority, y: Priority) => y.score - x.score);
  await mutate((db) => { db.priorities = items; });
  return { ok: true, ranked: items.length, top: items.slice(0, 5).map((p) => ({ score: p.score, title: p.title, why: p.why })) };
}

/**
 * Replace ONLY one objective's slice of the Priority Queue, preserving every
 * other objective's items. This is how the per-objective planner publishes its
 * recommendations without clobbering the rest of the queue. Re-sorts the whole
 * queue by score so the unified list stays coherent.
 */
export async function replaceObjectivePriorities(objectiveId: string, rawItems: any[]) {
  const fresh = (Array.isArray(rawItems) ? rawItems : [])
    .filter((it) => it && it.title && it.why)
    .slice(0, 15)
    .map((it) => toPriority(it, objectiveId));
  await mutate((db) => {
    const others = (db.priorities || []).filter((p) => p.objectiveId !== objectiveId);
    db.priorities = [...others, ...fresh].sort((x, y) => y.score - x.score).slice(0, 40);
  });
  return { ranked: fresh.length, top: fresh.slice(0, 5).map((p) => ({ score: p.score, title: p.title, why: p.why })) };
}

/* ---- Objectives (top of the hierarchy) ---- */
export async function listObjectives(): Promise<Objective[]> {
  return read((db) => db.objectives || []);
}
export async function listActiveObjectives(): Promise<Objective[]> {
  return read((db) => (db.objectives || []).filter((o) => o.status === "active"));
}
export async function getObjective(id: string): Promise<Objective | undefined> {
  return read((db) => (db.objectives || []).find((o) => o.id === id));
}
/** Patch an objective's evolving fields (state/progress/status/lastReviewedAt/…). */
export async function patchObjective(id: string, p: Partial<Objective>): Promise<Objective | undefined> {
  let out: Objective | undefined;
  await mutate((db) => {
    const o = (db.objectives || []).find((x) => x.id === id);
    if (!o) return;
    Object.assign(o, p, { updatedAt: Date.now() });
    out = o;
  });
  return out;
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
      if (a.leadSource) ex.leadSource = a.leadSource as Contact["leadSource"];
      if (a.brandId !== undefined) ex.brandId = a.brandId;
      if (a.budget != null && Number(a.budget)) ex.budget = Number(a.budget);
      if (a.notes) ex.notes = a.notes;
      ex.lastTouch = Date.now();
      updated = true;
    } else {
      db.contacts.unshift({
        id: uid(), brandId: a.brandId ?? null, name, email: a.email || "", phone: a.phone || "",
        type: (a.type as Contact["type"]) || "other",
        status: (a.status as LeadStatus) || "new",
        source: a.source || "", leadSource: a.leadSource as Contact["leadSource"],
        budget: Number(a.budget) || 0, notes: a.notes || "",
        lastTouch: Date.now(), createdAt: Date.now(),
      });
    }
  });
  return updated ? { ok: true, updated: name } : { ok: true, created: name };
}

/** Patch a lead's CRM/pipeline fields (stage, owner, nextAction, revenue, …). */
export async function patchContact(id: string, p: Partial<Contact>): Promise<Contact | undefined> {
  const editable = ["pipelineStage", "owner", "nextAction", "revenue", "status", "leadSource", "campaign", "lastContact", "notes", "budget", "brandId"] as const;
  let out: Contact | undefined;
  await mutate((db) => {
    const c = (db.contacts || []).find((x) => x.id === id);
    if (!c) return;
    for (const k of editable) if (k in p) (c as any)[k] = (p as any)[k];
    c.lastTouch = Date.now();
    out = c;
  });
  return out;
}

export async function createDeal(a: any) {
  let linkedName: string | null = null;
  const deal: Deal = {
    id: uid(),
    brandId: a.brandId ?? null,
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

/** File/document READ: fetch the full contents of a saved note by title (exact
 *  match preferred, else closest). Pairs with createNote (write) for real
 *  file operations on persisted documents. */
export async function readNote(a: any) {
  const q = String(a.title || "").trim().toLowerCase();
  return read((db) => {
    const n = db.notes.find((x) => x.title.toLowerCase() === q) || db.notes.find((x) => x.title.toLowerCase().includes(q));
    return n
      ? { ok: true, found: true, title: n.title, body: n.body, length: (n.body || "").length }
      : { ok: true, found: false, note: `No note matching "${a.title}".`, available: db.notes.slice(0, 10).map((x) => x.title) };
  });
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
