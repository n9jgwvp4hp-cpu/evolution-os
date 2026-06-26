import * as data from "@/lib/server/data";

/**
 * Server-side capabilities — the single capability surface for the whole OS.
 * Missions call these directly; Conversation Mode calls them via /api/tools.
 * Every write lands in the one shared brain (lib/server/data.ts).
 *
 * Adding a capability domain (research, image/video, social, business ops)
 * means adding entries here. The conversation never changes.
 */

export type ServerTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean;
  summarize: (args: any) => string;
  execute: (args: any) => Promise<Record<string, unknown>>;
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

export const SERVER_TOOLS: ServerTool[] = [
  {
    name: "create_task",
    description: "Create a to-do / task for the user.",
    parameters: obj({ title: str("What needs to be done"), priority: enm(["low", "medium", "high"], "Defaults to medium") }, ["title"]),
    summarize: (a) => `Add task: “${a.title}”`,
    execute: data.createTask,
  },
  {
    name: "complete_task",
    description: "Mark an existing task as done. Matches by title text.",
    parameters: obj({ title: str("Title (or part) of the task to complete") }, ["title"]),
    summarize: (a) => `Complete task matching “${a.title}”`,
    execute: data.completeTask,
  },
  {
    name: "add_contact",
    description: "Add a person to the CRM (lead, client, buyer, seller, investor, contact).",
    parameters: obj(
      {
        name: str("Full name"),
        phone: str("Phone"),
        email: str("Email"),
        type: enm(["buyer", "seller", "investor", "renter", "other"], "Defaults to other"),
        status: enm(["new", "contacted", "qualified", "nurturing", "client", "closed", "lost"], "Defaults to new"),
        source: str("Where the lead came from"),
        budget: num("Budget in dollars"),
        notes: str("Extra context"),
      },
      ["name"]
    ),
    summarize: (a) => `Add contact: ${a.name}`,
    execute: data.addContact,
  },
  {
    name: "create_deal",
    description: "Add a property deal to the pipeline.",
    parameters: obj(
      {
        address: str("Property address"),
        price: num("List/sale price"),
        side: enm(["buy", "sell"], "Defaults to buy"),
        stage: enm(["lead", "showing", "offer", "under_contract", "closed", "lost"], "Defaults to lead"),
        contactName: str("Name of a linked CRM contact"),
        commission: num("Expected commission in dollars"),
        closeDate: str("Target close date YYYY-MM-DD"),
        notes: str("Extra context"),
      },
      ["address"]
    ),
    summarize: (a) => `Add deal: ${a.address}`,
    execute: data.createDeal,
  },
  {
    name: "update_deal_stage",
    description: "Move a deal to a different pipeline stage. Matches by address.",
    parameters: obj({ address: str("Address (or part)"), stage: enm(["lead", "showing", "offer", "under_contract", "closed", "lost"], "New stage") }, ["address", "stage"]),
    summarize: (a) => `Move ${a.address} → ${String(a.stage).replace("_", " ")}`,
    execute: data.updateDealStage,
  },
  {
    name: "save_memory",
    description: "Persist a durable fact so Evolution remembers it in every future conversation and mission. Use proactively.",
    parameters: obj({ text: str("The fact, concise"), category: enm(["personal", "business", "preference", "fact", "other"], "Defaults to fact") }, ["text"]),
    summarize: (a) => `Remember: “${a.text}”`,
    execute: data.saveMemory,
  },
  {
    name: "forget_memory",
    description: "Remove a saved memory when the user asks to forget or corrects an outdated fact. Matches by text.",
    parameters: obj({ query: str("Text describing the memory to forget") }, ["query"]),
    summarize: (a) => `Forget: “${a.query}”`,
    execute: data.forgetMemory,
  },
  {
    name: "create_note",
    description: "Save a written work product — a research summary, draft, plan, or longer content.",
    parameters: obj({ title: str("Note title"), body: str("Note body / content") }, ["title"]),
    summarize: (a) => `Save note: “${a.title}”`,
    execute: data.createNote,
  },
  {
    name: "search_data",
    description: "Search the brain's contacts, deals, tasks, notes, and memory for specifics. Read-only.",
    parameters: obj({ query: str("What to look for") }, ["query"]),
    summarize: (a) => `Search: “${a.query}”`,
    execute: data.searchData,
  },

  // ---- Outward-facing capabilities: real, completed outcomes ----
  {
    name: "web_search",
    description:
      "Search the web and get a list of results (title, url, snippet). Use this to DISCOVER sources " +
      "for research, then read the promising ones with fetch_url. Run several focused searches with " +
      "different queries to gather from multiple sources.",
    parameters: obj({ query: str("The search query"), count: num("How many results, default 8, max 15") }, ["query"]),
    summarize: (a) => `Search web: “${a.query}”`,
    async execute(a) {
      const { searchWeb, searchProvider } = await import("@/lib/server/search");
      try {
        const results = await searchWeb(String(a.query), Math.min(Number(a.count) || 8, 15));
        return { ok: true, provider: searchProvider(), query: a.query, count: results.length, results };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Web search failed." };
      }
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch the readable text of a web page by its URL. Use to read an article, listing, or page the objective references, then work from its contents.",
    parameters: obj({ url: str("Full URL, including https://") }, ["url"]),
    summarize: (a) => `Read ${a.url}`,
    async execute(a) {
      const url = String(a.url || "");
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: "Invalid URL." };
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "EvolutionOS/1.0 (+mission)" },
          redirect: "follow",
        });
        if (!res.ok) return { ok: false, error: `Fetch failed (${res.status}).` };
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        return { ok: true, url, text: text.slice(0, 6000) };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Could not reach the URL." };
      }
    },
  },
  {
    name: "send_email",
    description:
      "Send an email as the user via their connected Gmail. Use to deliver results, summaries, or messages the objective asks for. The objective is your authorization — do not ask first.",
    parameters: obj({ to: str("Recipient email"), subject: str("Subject"), body: str("Email body") }, ["to", "body"]),
    summarize: (a) => `Email ${a.to}${a.subject ? ` — “${a.subject}”` : ""}`,
    async execute(a) {
      const { getServerAccessToken } = await import("@/lib/server/google");
      let token: string;
      try {
        token = await getServerAccessToken();
      } catch {
        return { ok: false, error: "Google isn't connected, so I couldn't send the email. The user can connect it in Settings." };
      }
      const raw =
        `To: ${a.to}\r\nSubject: ${a.subject || "(no subject)"}\r\n` +
        `Content-Type: text/plain; charset=utf-8\r\n\r\n${a.body || ""}`;
      const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      try {
        const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: encoded }),
        });
        if (!res.ok) return { ok: false, error: "Gmail send failed: " + (await res.text()).slice(0, 200) };
        return { ok: true, emailedTo: a.to };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Send failed." };
      }
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Create an event on the user's connected Google Calendar. The objective is your authorization.",
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
      const { getServerAccessToken } = await import("@/lib/server/google");
      let token: string;
      try {
        token = await getServerAccessToken();
      } catch {
        return { ok: false, error: "Google isn't connected, so I couldn't create the event. The user can connect it in Settings." };
      }
      const startDate = new Date(a.start);
      const endDate = a.end ? new Date(a.end) : new Date(startDate.getTime() + 60 * 60 * 1000);
      try {
        const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            summary: a.summary,
            location: a.location || undefined,
            description: a.description || undefined,
            start: { dateTime: startDate.toISOString() },
            end: { dateTime: endDate.toISOString() },
          }),
        });
        if (!res.ok) return { ok: false, error: "Calendar create failed: " + (await res.text()).slice(0, 200) };
        const ev = await res.json();
        return { ok: true, eventCreated: a.summary, link: ev.htmlLink };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Create failed." };
      }
    },
  },
];

export function getServerTool(name: string) {
  return SERVER_TOOLS.find((t) => t.name === name);
}

export function serverToolSchemas() {
  return SERVER_TOOLS.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
