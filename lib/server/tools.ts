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
