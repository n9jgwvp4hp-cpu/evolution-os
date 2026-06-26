"use client";

import {
  uid,
  type Task,
  type Contact,
  type Deal,
  type Memory,
  type Note,
  type StoredFile,
  type LeadStatus,
  type DealStage,
} from "@/lib/store";

/**
 * Evolution OS capability layer.
 *
 * Each tool is one capability the single intelligence can invoke to execute
 * real work. The model decides which to call; the chat runtime runs them
 * client-side (data lives in localStorage, the same keys the modules read)
 * and gates the sensitive ones behind a user approval step.
 *
 * Adding a new business/module = adding tools here. The chat experience
 * never changes.
 */

export type ToolResult = Record<string, unknown>;

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Sensitive actions pause for explicit user approval before running. */
  requiresApproval?: boolean;
  /** Short human label shown in the transcript / approval card. */
  summarize: (args: any) => string;
  execute: (args: any) => Promise<ToolResult>;
};

// ---- localStorage helpers (mirror the module pages' keys) ----
function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const enm = (values: string[], description: string) => ({
  type: "string",
  enum: values,
  description,
});

export const TOOLS: Tool[] = [
  // ---------------------------------------------------------------- TASKS
  {
    name: "create_task",
    description:
      "Create a to-do / task for the user. Use whenever the user wants to remember to do something or asks you to track an action.",
    parameters: obj(
      {
        title: str("What needs to be done"),
        priority: enm(["low", "medium", "high"], "Defaults to medium"),
      },
      ["title"]
    ),
    summarize: (a) => `Add task: “${a.title}”`,
    async execute(a) {
      const tasks = read<Task[]>("evo.tasks", []);
      const task: Task = {
        id: uid(),
        title: String(a.title),
        done: false,
        priority: (a.priority as Task["priority"]) || "medium",
        createdAt: Date.now(),
      };
      write("evo.tasks", [task, ...tasks]);
      return { ok: true, created: task.title };
    },
  },
  {
    name: "complete_task",
    description: "Mark an existing task as done. Matches by title text.",
    parameters: obj({ title: str("Title (or part of it) of the task to complete") }, ["title"]),
    summarize: (a) => `Complete task matching “${a.title}”`,
    async execute(a) {
      const tasks = read<Task[]>("evo.tasks", []);
      const q = String(a.title).toLowerCase();
      const target = tasks.find((t) => !t.done && t.title.toLowerCase().includes(q));
      if (!target) return { ok: false, error: "No matching open task found." };
      write("evo.tasks", tasks.map((t) => (t.id === target.id ? { ...t, done: true } : t)));
      return { ok: true, completed: target.title };
    },
  },

  // ------------------------------------------------------------------ CRM
  {
    name: "add_contact",
    description:
      "Add a person to the CRM (a lead, client, buyer, seller, investor, or general contact).",
    parameters: obj(
      {
        name: str("Full name"),
        phone: str("Phone number"),
        email: str("Email address"),
        type: enm(["buyer", "seller", "investor", "renter", "other"], "Defaults to other"),
        status: enm(
          ["new", "contacted", "qualified", "nurturing", "client", "closed", "lost"],
          "Defaults to new"
        ),
        source: str("Where the lead came from"),
        budget: num("Budget in dollars, if known"),
        notes: str("Any extra context"),
      },
      ["name"]
    ),
    summarize: (a) => `Add contact: ${a.name}`,
    async execute(a) {
      const contacts = read<Contact[]>("evo.contacts", []);
      const contact: Contact = {
        id: uid(),
        name: String(a.name),
        email: a.email || "",
        phone: a.phone || "",
        type: (a.type as Contact["type"]) || "other",
        status: (a.status as LeadStatus) || "new",
        source: a.source || "",
        budget: Number(a.budget) || 0,
        notes: a.notes || "",
        lastTouch: Date.now(),
        createdAt: Date.now(),
      };
      write("evo.contacts", [contact, ...contacts]);
      return { ok: true, created: contact.name };
    },
  },

  // -------------------------------------------------------------- PIPELINE
  {
    name: "create_deal",
    description: "Add a property deal to the pipeline tracker.",
    parameters: obj(
      {
        address: str("Property address"),
        price: num("List or sale price in dollars"),
        side: enm(["buy", "sell"], "Representing buyer or seller. Defaults to buy"),
        stage: enm(
          ["lead", "showing", "offer", "under_contract", "closed", "lost"],
          "Defaults to lead"
        ),
        contactName: str("Name of a linked CRM contact, if any"),
        commission: num("Expected commission in dollars"),
        closeDate: str("Target close date, ISO format YYYY-MM-DD"),
        notes: str("Any extra context"),
      },
      ["address"]
    ),
    summarize: (a) => `Add deal: ${a.address}`,
    async execute(a) {
      const deals = read<Deal[]>("evo.deals", []);
      const contacts = read<Contact[]>("evo.contacts", []);
      const linked = a.contactName
        ? contacts.find((c) => c.name.toLowerCase().includes(String(a.contactName).toLowerCase()))
        : null;
      const deal: Deal = {
        id: uid(),
        address: String(a.address),
        price: Number(a.price) || 0,
        side: (a.side as Deal["side"]) || "buy",
        stage: (a.stage as DealStage) || "lead",
        contactId: linked?.id ?? null,
        commission: Number(a.commission) || 0,
        closeDate: a.closeDate || "",
        notes: a.notes || "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      write("evo.deals", [deal, ...deals]);
      return { ok: true, created: deal.address, linkedContact: linked?.name ?? null };
    },
  },
  {
    name: "update_deal_stage",
    description: "Move a deal to a different pipeline stage. Matches by address text.",
    parameters: obj(
      {
        address: str("Address (or part of it) of the deal"),
        stage: enm(["lead", "showing", "offer", "under_contract", "closed", "lost"], "New stage"),
      },
      ["address", "stage"]
    ),
    summarize: (a) => `Move ${a.address} → ${String(a.stage).replace("_", " ")}`,
    async execute(a) {
      const deals = read<Deal[]>("evo.deals", []);
      const q = String(a.address).toLowerCase();
      const target = deals.find((d) => d.address.toLowerCase().includes(q));
      if (!target) return { ok: false, error: "No matching deal found." };
      write(
        "evo.deals",
        deals.map((d) =>
          d.id === target.id ? { ...d, stage: a.stage as DealStage, updatedAt: Date.now() } : d
        )
      );
      return { ok: true, deal: target.address, stage: a.stage };
    },
  },

  // -------------------------------------------------------------- MEMORY
  {
    name: "save_memory",
    description:
      "Save a durable fact about the user, their businesses, preferences, or people, so it is remembered in every future conversation. Use proactively when the user shares something worth keeping.",
    parameters: obj(
      {
        text: str("The fact to remember, written concisely"),
        category: enm(["personal", "business", "preference", "fact", "other"], "Defaults to fact"),
      },
      ["text"]
    ),
    summarize: (a) => `Remember: “${a.text}”`,
    async execute(a) {
      const memories = read<Memory[]>("evo.memories", []);
      const memory: Memory = {
        id: uid(),
        text: String(a.text),
        category: (a.category as Memory["category"]) || "fact",
        pinned: false,
        createdAt: Date.now(),
      };
      write("evo.memories", [memory, ...memories]);
      return { ok: true, remembered: memory.text };
    },
  },
  {
    name: "forget_memory",
    description:
      "Remove a saved memory when the user asks you to forget something or corrects an outdated fact. Matches by text.",
    parameters: obj({ query: str("Text describing the memory to forget") }, ["query"]),
    summarize: (a) => `Forget: “${a.query}”`,
    async execute(a) {
      const memories = read<Memory[]>("evo.memories", []);
      const q = String(a.query).toLowerCase();
      const target = memories.find((m) => m.text.toLowerCase().includes(q));
      if (!target) return { ok: false, error: "No matching memory found." };
      write("evo.memories", memories.filter((m) => m.id !== target.id));
      return { ok: true, forgot: target.text };
    },
  },

  // --------------------------------------------------------------- NOTES
  {
    name: "create_note",
    description: "Save a longer note or piece of written content for the user.",
    parameters: obj({ title: str("Note title"), body: str("Note body") }, ["title"]),
    summarize: (a) => `Save note: “${a.title}”`,
    async execute(a) {
      const notes = read<Note[]>("evo.notes", []);
      const note: Note = {
        id: uid(),
        title: String(a.title),
        body: a.body || "",
        updatedAt: Date.now(),
      };
      write("evo.notes", [note, ...notes]);
      return { ok: true, created: note.title };
    },
  },

  // -------------------------------------------------------- SEARCH (read)
  {
    name: "search_data",
    description:
      "Search across the user's contacts, deals, tasks, notes, and files when you need specific details to answer. Read-only.",
    parameters: obj({ query: str("What to look for") }, ["query"]),
    summarize: (a) => `Search: “${a.query}”`,
    async execute(a) {
      const q = String(a.query).toLowerCase();
      const hit = (s: string) => s.toLowerCase().includes(q);
      const contacts = read<Contact[]>("evo.contacts", []).filter(
        (c) => hit(c.name) || hit(c.email) || hit(c.phone) || hit(c.notes) || hit(c.source)
      );
      const deals = read<Deal[]>("evo.deals", []).filter((d) => hit(d.address) || hit(d.notes));
      const tasks = read<Task[]>("evo.tasks", []).filter((t) => hit(t.title));
      const notes = read<Note[]>("evo.notes", []).filter((n) => hit(n.title) || hit(n.body));
      const files = read<StoredFile[]>("evo.files", []).filter(
        (f) => hit(f.name) || hit(f.tags || "")
      );
      return {
        ok: true,
        contacts: contacts.slice(0, 10),
        deals: deals.slice(0, 10),
        tasks: tasks.slice(0, 10),
        notes: notes.slice(0, 5).map((n) => ({ title: n.title, body: n.body.slice(0, 200) })),
        files: files.slice(0, 10).map((f) => ({ name: f.name, tags: f.tags })),
      };
    },
  },

  // --------------------------------------------- EMAIL (needs approval)
  {
    name: "send_email",
    description: "Send an email on the user's behalf via their connected Gmail account.",
    requiresApproval: true,
    parameters: obj(
      { to: str("Recipient email"), subject: str("Subject"), body: str("Email body") },
      ["to", "body"]
    ),
    summarize: (a) => `Send email to ${a.to}${a.subject ? ` — “${a.subject}”` : ""}`,
    async execute(a) {
      const res = await fetch("/api/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: a.to, subject: a.subject, body: a.body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error:
            res.status === 401
              ? "Gmail isn't connected. Ask the user to connect Google in Settings."
              : data.error || "Failed to send email.",
        };
      }
      return { ok: true, sentTo: a.to };
    },
  },

  // ------------------------------------------ CALENDAR (needs approval)
  {
    name: "create_calendar_event",
    description: "Create an event on the user's connected Google Calendar.",
    requiresApproval: true,
    parameters: obj(
      {
        summary: str("Event title"),
        start: str("Start time, ISO 8601 (e.g. 2026-06-27T15:00:00)"),
        end: str("End time, ISO 8601. Optional — defaults to 1 hour."),
        location: str("Location, optional"),
        description: str("Description, optional"),
      },
      ["summary", "start"]
    ),
    summarize: (a) => `Create event “${a.summary}” at ${a.start}`,
    async execute(a) {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error:
            res.status === 401
              ? "Calendar isn't connected. Ask the user to connect Google in Settings."
              : data.error || "Failed to create event.",
        };
      }
      return { ok: true, created: a.summary, link: data.link };
    },
  },

  // ---------------------------------------------------- MISSION HANDOFF
  // Conversation Mode → Mission Mode. The model calls this when an objective
  // is large or multi-step; the runtime executes it in the background.
  {
    name: "start_mission",
    description:
      "Start a long-running MISSION that executes in the background with progress updates and a completion report. " +
      "Use this for objectives that take several steps or are better done in the background — research, " +
      "multi-step operations, draft-then-send sequences, anything that isn't a single quick action. " +
      "For a quick answer or one simple action, do it directly instead. " +
      "After calling this, tell the user in one short line that you've started and will report back.",
    parameters: obj(
      { objective: str("A clear, self-contained description of the goal to fully accomplish") },
      ["objective"]
    ),
    summarize: (a) => `Start mission: ${a.objective}`,
    async execute(a) {
      // Hand the objective to the backend. It executes persistently on the
      // server and keeps running even if the app is closed.
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: String(a.objective) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "Could not start mission." };
      return {
        ok: true,
        started: true,
        missionId: data.id,
        note: "Mission queued on the server. It runs in the background; the user can leave and the result will be waiting.",
      };
    },
  },

  /* ----------------------------------------------------------------------
   * FUTURE CAPABILITY DOMAINS
   * Evolution OS grows by adding tools here — the conversation never changes.
   * Each new domain (and the businesses built on it) plugs in as more Tool
   * entries; the model routes objectives to them automatically. Planned:
   *   • Email & comms   • Contacts/CRM   • Calendar & scheduling
   *   • Files & documents   • AI image generation   • AI video generation
   *   • Social media   • Research   • Real-estate analysis   • Business ops
   * -------------------------------------------------------------------- */
];

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** OpenAI tool-schema array sent with each request (optionally excluding some). */
export function toolSchemas(exclude: string[] = []) {
  return TOOLS.filter((t) => !exclude.includes(t.name)).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
