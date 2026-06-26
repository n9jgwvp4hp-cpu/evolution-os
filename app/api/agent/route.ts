import { NextRequest } from "next/server";

// Runs on the server so the API key is never exposed to the browser.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
  name?: string;
};

/**
 * The single intelligence of Evolution OS.
 *
 * Tool-aware, non-streaming. The browser sends the running conversation plus
 * the available tool schemas; this returns the model's next message — either
 * final text or a set of tool calls for the client to execute. The client
 * loops back with tool results until the model produces a final reply.
 */
export async function POST(req: NextRequest) {
  let body: { messages?: Msg[]; tools?: unknown[]; context?: string; model?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const headerKey = req.headers.get("x-openai-key")?.trim();
  const apiKey = process.env.OPENAI_API_KEY || headerKey;
  if (!apiKey) {
    return Response.json(
      { error: "No OpenAI API key found. Add it to .env.local or the Settings page." },
      { status: 401 }
    );
  }

  const model = body.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  // Context comes from the shared server brain — one source of truth for what
  // Evolution knows, identical to what missions see.
  const { buildBrainContext } = await import("@/lib/server/data");
  const context = (await buildBrainContext()).trim();
  const mode = body.mode === "mission" ? "mission" : "conversation";

  const shared =
    "You are Evolution OS — a single personal intelligence the user talks to from their phone " +
    "to get real work done across all of their businesses, projects, and life. " +
    "You are an operator that DELEGATES and EXECUTES, not a chatbot. " +
    "The user thinks only in OBJECTIVES — never in tools, modules, workflows, or agents. " +
    "Hide all machinery; make them feel they delegated to one capable assistant.\n";

  const conversation =
    "MODE: Conversation. Respond immediately. Answer questions and give guidance directly.\n" +
    "- Default to ACTION: when a request implies work (a task, contact, deal, note, email, event, " +
    "or a durable fact to remember), call the right capability instead of describing it.\n" +
    "- For a BIG or multi-step objective (research, drafting then sending, several operations, " +
    "anything that runs for a while), call start_mission with a clear objective and tell the user " +
    "in one short line that you've started and will report back. Don't try to do huge work inline.\n" +
    "- Sensitive actions (sending email, creating calendar events) are auto-gated with a user approval " +
    "prompt — just call them when appropriate; don't ask permission in text first. If a result says " +
    "the user declined, accept it gracefully.\n" +
    "- Proactively call save_memory when the user shares durable facts.\n" +
    "- Keep replies short, calm, and mobile-friendly — a line or two. No markdown headers, no long lists.\n";

  const mission =
    "MODE: Mission (background execution). You are autonomously completing a long-running objective.\n" +
    "- Work step by step using capabilities until the objective is fully done. Make reasonable " +
    "assumptions instead of asking the user questions — they are not watching live.\n" +
    "- Each assistant message is a brief progress note (one line) describing what you're doing.\n" +
    "- Sensitive actions are still gated for approval; call them when needed and the user will be asked.\n" +
    "- When the objective is complete, send a final message with NO tool calls: a concise report of " +
    "what you accomplished and any result the user needs. Keep going until then.\n";

  const system: Msg = {
    role: "system",
    content:
      shared +
      "\n" +
      (mode === "mission" ? mission : conversation) +
      (context ? "\nWhat you currently know about the user and their work:\n\n" + context : ""),
  };

  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [system, ...(body.messages ?? [])],
        tools: body.tools && body.tools.length ? body.tools : undefined,
        tool_choice: body.tools && body.tools.length ? "auto" : undefined,
        temperature: 0.4,
      }),
    });
  } catch {
    return Response.json({ error: "Could not reach OpenAI." }, { status: 502 });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = "OpenAI request failed.";
    try {
      message = JSON.parse(text)?.error?.message || message;
    } catch {
      /* keep default */
    }
    return Response.json({ error: message }, { status: res.status });
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message ?? { role: "assistant", content: "" };
  return Response.json({ message });
}
