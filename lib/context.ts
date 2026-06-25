"use client";

import type { Memory, Contact, Deal, Task, Note } from "@/lib/store";
import { formatMoney } from "@/lib/store";

/**
 * Read everything from localStorage and compress it into a compact text
 * block that gets injected into the assistant's system prompt. This is what
 * gives the assistant "long-term memory" of your business.
 */
export function buildAssistantContext(): string {
  if (typeof window === "undefined") return "";

  const read = <T,>(key: string): T[] => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
      return [];
    }
  };

  const memories = read<Memory>("evo.memories");
  const contacts = read<Contact>("evo.contacts");
  const deals = read<Deal>("evo.deals");
  const tasks = read<Task>("evo.tasks");
  const notes = read<Note>("evo.notes");

  const parts: string[] = [];

  if (memories.length) {
    const sorted = [...memories].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned)
    );
    parts.push(
      "## Long-term memory\n" +
        sorted.slice(0, 40).map((m) => `- ${m.text}`).join("\n")
    );
  }

  const openDeals = deals.filter((d) => d.stage !== "closed" && d.stage !== "lost");
  if (openDeals.length) {
    parts.push(
      "## Active property deals\n" +
        openDeals
          .slice(0, 20)
          .map(
            (d) =>
              `- ${d.address} · ${d.side} · ${d.stage.replace("_", " ")} · ${formatMoney(
                d.price
              )}${d.closeDate ? ` · close ${d.closeDate}` : ""}`
          )
          .join("\n")
    );
  }

  const activeLeads = contacts.filter(
    (c) => c.status !== "closed" && c.status !== "lost"
  );
  if (activeLeads.length) {
    parts.push(
      "## CRM leads & contacts\n" +
        activeLeads
          .slice(0, 25)
          .map(
            (c) =>
              `- ${c.name} (${c.type}, ${c.status})${
                c.phone ? ` · ${c.phone}` : ""
              }${c.budget ? ` · budget ${formatMoney(c.budget)}` : ""}`
          )
          .join("\n")
    );
  }

  const openTasks = tasks.filter((t) => !t.done);
  if (openTasks.length) {
    parts.push(
      "## Open tasks\n" +
        openTasks
          .slice(0, 20)
          .map((t) => `- [${t.priority}] ${t.title}`)
          .join("\n")
    );
  }

  if (notes.length) {
    parts.push(
      "## Recent notes\n" +
        notes
          .slice(0, 8)
          .map((n) => `- ${n.title}: ${n.body.slice(0, 120)}`)
          .join("\n")
    );
  }

  return parts.join("\n\n");
}
