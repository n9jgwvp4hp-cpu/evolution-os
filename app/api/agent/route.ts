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
  let body: { messages?: Msg[]; tools?: unknown[]; context?: string; model?: string };
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
  const context = (body.context ?? "").trim();

  const system: Msg = {
    role: "system",
    content:
      "You are Evolution OS — a single personal intelligence the user talks to from their phone " +
      "to get real work done across all of their businesses, projects, and life. " +
      "You are not a chatbot; you are an operator that DELEGATES and EXECUTES.\n\n" +
      "Behaviour:\n" +
      "- Default to ACTION. When a request implies work (a task, a contact, a deal, a note, an email, " +
      "an event, remembering a fact), call the appropriate tool instead of just describing it.\n" +
      "- You may call multiple tools to fully complete a request.\n" +
      "- Sensitive tools (sending email, creating calendar events) are automatically gated: the user " +
      "is shown an approval prompt before they run. So just call them when appropriate — do not ask " +
      "for permission in text first. If a tool result says the user declined, acknowledge gracefully.\n" +
      "- Proactively call save_memory when the user shares durable facts (preferences, people, businesses, ongoing work).\n" +
      "- Keep replies short, calm, and mobile-friendly. Confirm what you did in one or two lines. " +
      "Avoid long lists and walls of text. No markdown headers.\n" +
      "- Hide the machinery. The user should feel they delegated to one capable assistant, not operated software.\n" +
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
