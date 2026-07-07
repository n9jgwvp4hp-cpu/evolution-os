import * as data from "@/lib/server/data";
import { fetchWithTimeout } from "@/lib/server/http";

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
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20_000);
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "EvolutionOS/1.0 (+mission)" },
          redirect: "follow",
          signal: ctrl.signal,
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
        return { ok: false, error: e?.name === "AbortError" ? "Timed out fetching the URL." : e?.message || "Could not reach the URL." };
      } finally {
        clearTimeout(timer);
      }
    },
  },

  // ---- Perception: read the user's world (read-only; the OS's "eyes") ----
  {
    name: "read_recent_email",
    description:
      "Read the user's recent Gmail messages (READ-ONLY) — sender, subject, date, and a snippet of each. " +
      "Use this to PERCEIVE the inbox: new leads, client replies, things needing a response. The optional " +
      "query uses Gmail search syntax (e.g. 'is:unread', 'newer_than:2d', 'from:zillow', 'is:important').",
    parameters: obj(
      { query: str("Gmail search query, e.g. 'is:unread newer_than:3d'. Defaults to recent unread."), max: num("How many messages, default 10, max 20") },
      []
    ),
    summarize: (a) => `Read inbox${a.query ? ` (${a.query})` : ""}`,
    async execute(a) {
      const { getServerAccessToken } = await import("@/lib/server/google");
      let token: string;
      try { token = await getServerAccessToken(); }
      catch { return { ok: false, error: "Google isn't connected, so I can't read the inbox. The user can connect it in Settings." }; }
      const q = String(a.query || "is:unread newer_than:7d");
      const max = Math.min(Number(a.max) || 10, 20);
      try {
        const listRes = await fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!listRes.ok) return { ok: false, error: "Gmail list failed: " + (await listRes.text()).slice(0, 200) };
        const refs = (await listRes.json()).messages || [];
        const messages: any[] = [];
        for (const r of refs.slice(0, max)) {
          const mRes = await fetchWithTimeout(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${r.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!mRes.ok) continue;
          const md = await mRes.json();
          const hdr: Record<string, string> = {};
          for (const h of md.payload?.headers || []) hdr[h.name.toLowerCase()] = h.value;
          messages.push({ from: hdr.from || "", subject: hdr.subject || "(no subject)", date: hdr.date || "", snippet: (md.snippet || "").slice(0, 240) });
        }
        return { ok: true, query: q, count: messages.length, messages };
      } catch (e: any) {
        return { ok: false, error: e?.name === "AbortError" ? "Gmail read timed out." : e?.message || "Read failed." };
      }
    },
  },
  {
    name: "list_calendar",
    description:
      "List the user's upcoming Google Calendar events (READ-ONLY) — title, start, end, location. " +
      "Use this to PERCEIVE the schedule: what's coming up, what to prepare for.",
    parameters: obj({ days: num("How many days ahead, default 7"), max: num("Max events, default 10, max 25") }, []),
    summarize: (a) => `List calendar (next ${a.days || 7}d)`,
    async execute(a) {
      const { getServerAccessToken } = await import("@/lib/server/google");
      let token: string;
      try { token = await getServerAccessToken(); }
      catch { return { ok: false, error: "Google isn't connected, so I can't read the calendar. The user can connect it in Settings." }; }
      const days = Math.min(Number(a.days) || 7, 60);
      const max = Math.min(Number(a.max) || 10, 25);
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
      try {
        const res = await fetchWithTimeout(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=${max}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return { ok: false, error: "Calendar list failed: " + (await res.text()).slice(0, 200) };
        const events = ((await res.json()).items || []).map((e: any) => ({
          summary: e.summary || "(untitled)",
          start: e.start?.dateTime || e.start?.date,
          end: e.end?.dateTime || e.end?.date,
          location: e.location || "",
        }));
        return { ok: true, days, count: events.length, events };
      } catch (e: any) {
        return { ok: false, error: e?.name === "AbortError" ? "Calendar read timed out." : e?.message || "Read failed." };
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
        const res = await fetchWithTimeout("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ raw: encoded }),
        });
        if (!res.ok) return { ok: false, error: "Gmail send failed: " + (await res.text()).slice(0, 200) };
        return { ok: true, emailedTo: a.to };
      } catch (e: any) {
        return { ok: false, error: e?.name === "AbortError" ? "Gmail send timed out." : e?.message || "Send failed." };
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
        const res = await fetchWithTimeout("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
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
        return { ok: false, error: e?.name === "AbortError" ? "Calendar create timed out." : e?.message || "Create failed." };
      }
    },
  },

  // ---- Safe autonomous execution: prepare work, never commit outward without review ----
  {
    name: "draft_email",
    description:
      "DRAFT an email reply as a real Gmail draft, saved to the user's Gmail Drafts for review — it is NEVER " +
      "sent automatically. Use this to prepare replies to leads/clients autonomously. Idempotent: a draft to " +
      "the same recipient with the same subject won't be created twice.",
    parameters: obj(
      { to: str("Recipient email"), subject: str("Subject (use 'Re: …' for replies)"), body: str("The drafted reply text") },
      ["to", "body"]
    ),
    summarize: (a) => `Draft Gmail reply to ${a.to}${a.subject ? ` — “${a.subject}”` : ""} (not sent)`,
    async execute(a) {
      const subject = a.subject || "(no subject)";
      const norm = (s: string) => s.toLowerCase().replace(/^(re:\s*)+/i, "").trim();
      const { getServerAccessToken } = await import("@/lib/server/google");
      let token: string;
      try { token = await getServerAccessToken(); }
      catch { return { ok: false, error: "Google isn't connected. Connect it in Settings." }; }
      const auth = { Authorization: `Bearer ${token}` };
      try {
        // Idempotency: skip if a draft to this recipient + (normalized) subject already exists.
        const listRes = await fetchWithTimeout("https://gmail.googleapis.com/gmail/v1/users/me/drafts?maxResults=25", { headers: auth });
        if (listRes.ok) {
          const drafts = (await listRes.json()).drafts || [];
          for (const dr of drafts.slice(0, 25)) {
            const g = await fetchWithTimeout(
              `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${dr.id}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`,
              { headers: auth }
            );
            if (!g.ok) continue;
            const hdr: Record<string, string> = {};
            for (const h of (await g.json()).message?.payload?.headers || []) hdr[h.name.toLowerCase()] = h.value;
            if ((hdr.to || "").toLowerCase().includes(a.to.toLowerCase()) && norm(hdr.subject || "") === norm(subject)) {
              return { ok: true, drafted: true, draftId: dr.id, to: a.to, deduped: true, note: "A matching Gmail draft already exists — not duplicated. Not sent." };
            }
          }
        }
        const raw = `To: ${a.to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${a.body || ""}`;
        const encoded = Buffer.from(raw).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const res = await fetchWithTimeout("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { raw: encoded } }),
        });
        if (res.ok) {
          const d = await res.json();
          return { ok: true, drafted: true, draftId: d.id, to: a.to, subject, note: "Created a Gmail draft — review and send it yourself. Not sent." };
        }
        const errTxt = (await res.text()).slice(0, 300);
        const scopeIssue = res.status === 403 || /insufficient|scope|permission|ACCESS_TOKEN_SCOPE/i.test(errTxt);
        return {
          ok: false,
          error: scopeIssue
            ? "Gmail draft permission not granted. Reconnect Google in Settings — the consent now includes the gmail.compose scope needed to create drafts."
            : `Gmail draft failed (${res.status}): ${errTxt}`,
        };
      } catch (e: any) {
        return { ok: false, error: e?.name === "AbortError" ? "Gmail draft timed out." : e?.message || "Draft failed." };
      }
    },
  },
  {
    name: "suggest_calendar_event",
    description:
      "QUEUE a suggested calendar action for the user to approve — it does NOT create the event. Use when the " +
      "objective implies scheduling (e.g. a follow-up meeting). Idempotent: suggesting the same event won't duplicate.",
    parameters: obj(
      { summary: str("Event title"), start: str("Suggested start, human or ISO"), note: str("Why / context, optional") },
      ["summary", "start"]
    ),
    summarize: (a) => `Queue calendar suggestion: “${a.summary}” (${a.start})`,
    async execute(a) {
      const { createTask } = await import("@/lib/server/data");
      // Reuse the idempotent task list as the visible approval queue.
      const title = `📅 Schedule: ${a.summary} — ${a.start}`;
      const r: any = await createTask({ title, priority: "medium" });
      return { ok: true, queued: title, deduped: !!r.existing, note: a.note || "" };
    },
  },

  // ---- Executive assistant: perceive pending work + publish the ranked Priority Queue ----
  {
    name: "list_pending_work",
    description:
      "Read the user's PENDING WORK to factor into prioritization: open tasks, and active missions (queued / " +
      "running / waiting-for-approval). Read-only.",
    parameters: obj({}, []),
    summarize: () => "Review pending work (tasks + active missions)",
    async execute() {
      const { listKind } = await import("@/lib/server/data");
      const { listMissionViews } = await import("@/lib/server/missionStore");
      const tasks = (await listKind("tasks")).filter((t: any) => !t.done).map((t: any) => ({ title: t.title, priority: t.priority }));
      const missions = (await listMissionViews())
        .filter((m: any) => ["queued", "running", "needs_approval"].includes(m.status))
        .slice(0, 25)
        .map((m: any) => ({ status: m.status, objective: String(m.objective).slice(0, 120) }));
      return { ok: true, openTasks: tasks.length, tasks: tasks.slice(0, 40), activeMissions: missions.length, missions };
    },
  },
  {
    name: "set_priorities",
    description:
      "Publish the unified PRIORITY QUEUE: the full ranked list of what the user should focus on, rebuilt from " +
      "your analysis of Gmail, Calendar, CRM, missions, and pending work. This REPLACES the queue each cycle. " +
      "For EACH item provide urgency (1-5), importance (1-5), an optional deadline (ISO) and dependsOn, a " +
      "concrete recommendedAction, and a REQUIRED `why` explaining why it surfaced now. Ranking (score) is " +
      "computed for you from these signals.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          description: "The ranked work items (max 25).",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "recommendedAction", "why"],
            properties: {
              title: str("Short title of the work item"),
              category: enm(["email", "calendar", "crm", "mission", "task", "other"], "What kind of work"),
              urgency: num("Time pressure, 1-5"),
              importance: num("Impact if done / cost if missed, 1-5"),
              deadline: str("ISO date if there's a hard deadline, optional"),
              dependsOn: str("What blocks this item, optional"),
              recommendedAction: str("The concrete next action to take"),
              why: str("REQUIRED: why this surfaced now"),
              source: str("Where it came from, e.g. 'gmail:eric@…', 'deal:123 Main St'"),
            },
          },
        },
      },
    },
    summarize: (a) => `Publish Priority Queue (${(a.items || []).length} ranked items)`,
    async execute(a) {
      const { setPriorities } = await import("@/lib/server/data");
      return setPriorities(a);
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
