import { mutate, read, uid } from "@/lib/server/db";

/**
 * Server-side capabilities — what a Mission can actually execute on the
 * backend, independent of any browser. Each writes to the durable store.
 *
 * Adding a capability domain (email, calendar, research, image/video, social,
 * business ops) means adding entries here. Missions gain it automatically; the
 * conversation never changes. Sensitive/external actions are marked
 * requiresApproval and pause the mission until the user decides.
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

export const SERVER_TOOLS: ServerTool[] = [
  {
    name: "recall",
    description:
      "Search the user's persistent memory, notes, and tasks for facts you need to do the work. Read-only. Use this before assuming anything.",
    parameters: obj({ query: str("What to look for") }, ["query"]),
    summarize: (a) => `Recall: “${a.query}”`,
    async execute(a) {
      const q = String(a.query || "").toLowerCase();
      const hit = (s: string) => s.toLowerCase().includes(q);
      return read((db) => ({
        ok: true,
        memories: db.memories.filter((m) => hit(m.text)).slice(0, 20).map((m) => m.text),
        notes: db.notes.filter((n) => hit(n.title) || hit(n.body)).slice(0, 10).map((n) => ({ title: n.title, body: n.body.slice(0, 300) })),
        tasks: db.tasks.filter((t) => hit(t.title)).slice(0, 20).map((t) => t.title),
      }));
    },
  },
  {
    name: "save_memory",
    description:
      "Persist a durable fact learned while working, so Evolution remembers it in every future conversation and mission.",
    parameters: obj({ text: str("The fact, concise"), category: str("personal | business | preference | fact | other") }, ["text"]),
    summarize: (a) => `Remember: “${a.text}”`,
    async execute(a) {
      const mem = { id: uid(), text: String(a.text), category: a.category || "fact", createdAt: Date.now() };
      await mutate((db) => db.memories.unshift(mem));
      return { ok: true, remembered: mem.text };
    },
  },
  {
    name: "create_note",
    description:
      "Save a written work product — a research summary, draft, plan, or any longer content the user should keep.",
    parameters: obj({ title: str("Note title"), body: str("Note body / content") }, ["title", "body"]),
    summarize: (a) => `Save note: “${a.title}”`,
    async execute(a) {
      const note = { id: uid(), title: String(a.title), body: String(a.body || ""), createdAt: Date.now() };
      await mutate((db) => db.notes.unshift(note));
      return { ok: true, savedNote: note.title };
    },
  },
  {
    name: "create_task",
    description: "Create a durable follow-up task for the user.",
    parameters: obj({ title: str("What needs to be done"), priority: str("low | medium | high") }, ["title"]),
    summarize: (a) => `Add task: “${a.title}”`,
    async execute(a) {
      const task = { id: uid(), title: String(a.title), done: false, priority: a.priority || "medium", createdAt: Date.now() };
      await mutate((db) => db.tasks.unshift(task));
      return { ok: true, created: task.title };
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

/** Compact view of persistent memory injected into every mission. */
export async function buildServerContext(): Promise<string> {
  return read((db) => {
    const parts: string[] = [];
    if (db.memories.length) {
      parts.push("Known facts:\n" + db.memories.slice(0, 40).map((m) => `- ${m.text}`).join("\n"));
    }
    const open = db.tasks.filter((t) => !t.done);
    if (open.length) {
      parts.push("Open tasks:\n" + open.slice(0, 20).map((t) => `- ${t.title}`).join("\n"));
    }
    return parts.join("\n\n");
  });
}
