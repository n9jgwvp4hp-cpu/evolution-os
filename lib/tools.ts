"use client";

/**
 * Conversation-Mode capabilities (client side of the loop).
 *
 * Data capabilities now EXECUTE ON THE SERVER (POST /api/tools/[name]) so a
 * conversation action writes to the exact same persistent brain a mission
 * does. This module only carries the schema + UX (approval, summary) the chat
 * needs; the real work lives in lib/server/data.ts.
 *
 * Sensitive, externally-visible actions (send email, create calendar event)
 * keep their approval gate and run through their existing endpoints. Big
 * objectives hand off to the backend mission queue.
 */

export type ToolResult = Record<string, unknown>;

export type Tool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean;
  summarize: (args: any) => string;
  execute: (args: any) => Promise<ToolResult>;
};

const obj = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const enm = (values: string[], description: string) => ({ type: "string", enum: values, description });

/** A capability whose work runs server-side against the shared brain. */
function brainTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  summarize: (a: any) => string
): Tool {
  return {
    name,
    description,
    parameters,
    summarize,
    async execute(args) {
      const res = await fetch(`/api/tools/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args || {}),
      });
      return res.json().catch(() => ({ ok: false, error: "Capability failed." }));
    },
  };
}

export const TOOLS: Tool[] = [
  brainTool("create_task",
    "Create a to-do / task for the user.",
    obj({ title: str("What needs to be done"), priority: enm(["low", "medium", "high"], "Defaults to medium") }, ["title"]),
    (a) => `Add task: “${a.title}”`),

  brainTool("complete_task",
    "Mark an existing task as done. Matches by title text.",
    obj({ title: str("Title (or part) of the task to complete") }, ["title"]),
    (a) => `Complete task matching “${a.title}”`),

  brainTool("add_contact",
    "Add a person to the CRM (lead, client, buyer, seller, investor, contact).",
    obj({
      name: str("Full name"), phone: str("Phone"), email: str("Email"),
      type: enm(["buyer", "seller", "investor", "renter", "other"], "Defaults to other"),
      status: enm(["new", "contacted", "qualified", "nurturing", "client", "closed", "lost"], "Defaults to new"),
      source: str("Where the lead came from"), budget: num("Budget in dollars"), notes: str("Extra context"),
    }, ["name"]),
    (a) => `Add contact: ${a.name}`),

  brainTool("create_deal",
    "Add a property deal to the pipeline.",
    obj({
      address: str("Property address"), price: num("List/sale price"),
      side: enm(["buy", "sell"], "Defaults to buy"),
      stage: enm(["lead", "showing", "offer", "under_contract", "closed", "lost"], "Defaults to lead"),
      contactName: str("Name of a linked CRM contact"), commission: num("Expected commission"),
      closeDate: str("Target close date YYYY-MM-DD"), notes: str("Extra context"),
    }, ["address"]),
    (a) => `Add deal: ${a.address}`),

  brainTool("update_deal_stage",
    "Move a deal to a different pipeline stage. Matches by address.",
    obj({ address: str("Address (or part)"), stage: enm(["lead", "showing", "offer", "under_contract", "closed", "lost"], "New stage") }, ["address", "stage"]),
    (a) => `Move ${a.address} → ${String(a.stage).replace("_", " ")}`),

  brainTool("save_memory",
    "Persist a durable fact so Evolution remembers it in every future conversation and mission. Use proactively when the user shares something durable.",
    obj({ text: str("The fact, concise"), category: enm(["personal", "business", "preference", "fact", "other"], "Defaults to fact") }, ["text"]),
    (a) => `Remember: “${a.text}”`),

  brainTool("forget_memory",
    "Remove a saved memory when the user asks to forget or corrects an outdated fact.",
    obj({ query: str("Text describing the memory to forget") }, ["query"]),
    (a) => `Forget: “${a.query}”`),

  brainTool("create_note",
    "Save a longer note or written content for the user.",
    obj({ title: str("Note title"), body: str("Note body") }, ["title"]),
    (a) => `Save note: “${a.title}”`),

  brainTool("search_data",
    "Search the brain's contacts, deals, tasks, notes, and memory for specifics. Read-only.",
    obj({ query: str("What to look for") }, ["query"]),
    (a) => `Search: “${a.query}”`),

  // ---- Sensitive, externally-visible: keep the approval gate ----
  {
    name: "send_email",
    description: "Send an email on the user's behalf via their connected Gmail account.",
    requiresApproval: true,
    parameters: obj({ to: str("Recipient email"), subject: str("Subject"), body: str("Email body") }, ["to", "body"]),
    summarize: (a) => `Send email to ${a.to}${a.subject ? ` — “${a.subject}”` : ""}`,
    async execute(a) {
      const res = await fetch("/api/gmail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: a.to, subject: a.subject, body: a.body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: res.status === 401 ? "Gmail isn't connected. Connect Google in Settings." : data.error || "Failed to send email." };
      return { ok: true, sentTo: a.to };
    },
  },
  {
    name: "create_calendar_event",
    description: "Create an event on the user's connected Google Calendar.",
    requiresApproval: true,
    parameters: obj({
      summary: str("Event title"), start: str("Start time, ISO 8601"),
      end: str("End time, ISO 8601. Optional — defaults to 1 hour."),
      location: str("Location, optional"), description: str("Description, optional"),
    }, ["summary", "start"]),
    summarize: (a) => `Create event “${a.summary}” at ${a.start}`,
    async execute(a) {
      const res = await fetch("/api/calendar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: res.status === 401 ? "Calendar isn't connected. Connect Google in Settings." : data.error || "Failed to create event." };
      return { ok: true, created: a.summary, link: data.link };
    },
  },

  // ---- Conversation → Mission handoff (persistent background execution) ----
  {
    name: "start_mission",
    description:
      "Start a long-running MISSION that executes in the background with progress and a completion report. " +
      "Use for objectives that take several steps or are better done in the background — research, multi-step " +
      "operations, draft-then-send sequences. For a quick answer or one simple action, do it directly. " +
      "After calling this, tell the user in one short line that you've started and will report back.",
    parameters: obj({ objective: str("A clear, self-contained description of the goal") }, ["objective"]),
    summarize: (a) => `Start mission: ${a.objective}`,
    async execute(a) {
      const res = await fetch("/api/missions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective: String(a.objective) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "Could not start mission." };
      return { ok: true, started: true, missionId: data.id, note: "Mission queued on the server; it runs in the background and the result will be waiting." };
    },
  },
  {
    name: "schedule_mission",
    description:
      "Schedule a MISSION to run later and/or on a repeating interval, executed by the always-on server. " +
      "Use for time-based or recurring objectives ('in 2 hours', 'every morning', 'each week'). " +
      "delayMinutes = how long from now the first run starts (0 = now). everyMinutes = repeat interval " +
      "(omit for one-time; 1440 = daily, 10080 = weekly). After calling, confirm in one short line when " +
      "it will run and whether it repeats.",
    parameters: obj(
      {
        objective: str("A clear, self-contained description of the goal"),
        delayMinutes: num("Minutes from now until the first run (0 = immediately)"),
        everyMinutes: num("Repeat interval in minutes (omit or 0 for a one-time mission)"),
      },
      ["objective"]
    ),
    summarize: (a) =>
      `Schedule: ${a.objective}` +
      (a.delayMinutes ? ` (in ${a.delayMinutes}m)` : "") +
      (a.everyMinutes ? ` every ${a.everyMinutes}m` : ""),
    async execute(a) {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: String(a.objective),
          delayMinutes: Number(a.delayMinutes) || 0,
          everyMinutes: Number(a.everyMinutes) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || "Could not schedule mission." };
      return {
        ok: true,
        scheduled: true,
        missionId: data.id,
        scheduledFor: data.scheduledFor,
        recurring: Boolean(a.everyMinutes),
      };
    },
  },

  /* ----------------------------------------------------------------------
   * FUTURE CAPABILITY DOMAINS — add here and they work in both modes:
   *   email · contacts · calendar · files · AI image · AI video ·
   *   social · research · real-estate analysis · business ops
   * -------------------------------------------------------------------- */
];

export function getTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function toolSchemas(exclude: string[] = []) {
  return TOOLS.filter((t) => !exclude.includes(t.name)).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
