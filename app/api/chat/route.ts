import { NextRequest } from "next/server";

// Always run this on the server so the API key is never exposed to the browser.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMessage[]; model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const messages = body.messages ?? [];

  // The key comes from your .env.local file (preferred) OR, as a fallback,
  // from a key you saved on the Settings page (sent in this header).
  const headerKey = req.headers.get("x-openai-key")?.trim();
  const apiKey = process.env.OPENAI_API_KEY || headerKey;

  if (!apiKey) {
    return Response.json(
      {
        error:
          "No OpenAI API key found. Add it to your .env.local file or save it on the Settings page.",
      },
      { status: 401 }
    );
  }

  const model =
    body.model || process.env.OPENAI_MODEL || "gpt-4o-mini";

  const systemPrompt: ChatMessage = {
    role: "system",
    content:
      "You are Evolution OS, a helpful, concise personal AI assistant. " +
      "Be friendly and clear. Use short paragraphs. When useful, format with markdown.",
  };

  let openaiRes: Response;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [systemPrompt, ...messages],
      }),
    });
  } catch {
    return Response.json(
      { error: "Could not reach OpenAI. Check your internet connection." },
      { status: 502 }
    );
  }

  if (!openaiRes.ok || !openaiRes.body) {
    const errText = await openaiRes.text().catch(() => "");
    let message = "OpenAI request failed.";
    try {
      message = JSON.parse(errText)?.error?.message || message;
    } catch {
      /* keep default */
    }
    return Response.json({ error: message }, { status: openaiRes.status });
  }

  // Transform OpenAI's Server-Sent-Events stream into plain text chunks
  // that the browser can append as they arrive.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = openaiRes.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data);
              const token = json.choices?.[0]?.delta?.content;
              if (token) controller.enqueue(encoder.encode(token));
            } catch {
              /* ignore keep-alive / partial lines */
            }
          }
        }
        controller.close();
      } catch {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
