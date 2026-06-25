import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

function header(headers: any[], name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

/** GET — list recent messages (optionally filtered by ?q=). */
export async function GET(req: NextRequest) {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return NextResponse.json({ error: "Not connected to Google." }, { status: 401 });
  }

  const q = new URL(req.url).searchParams.get("q") || "";
  const auth = { Authorization: `Bearer ${token}` };

  try {
    const listUrl = new URL(`${API}/messages`);
    listUrl.searchParams.set("maxResults", "15");
    if (q) listUrl.searchParams.set("q", q);
    const list = await fetch(listUrl, { headers: auth }).then((r) => r.json());

    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
    const messages = await Promise.all(
      ids.map(async (id) => {
        const m = await fetch(
          `${API}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: auth }
        ).then((r) => r.json());
        return {
          id,
          from: header(m.payload?.headers, "From"),
          subject: header(m.payload?.headers, "Subject"),
          date: header(m.payload?.headers, "Date"),
          snippet: m.snippet ?? "",
          unread: (m.labelIds ?? []).includes("UNREAD"),
        };
      })
    );
    return NextResponse.json({ messages });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Gmail request failed." }, { status: 502 });
  }
}

/** POST — send an email { to, subject, body }. */
export async function POST(req: NextRequest) {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return NextResponse.json({ error: "Not connected to Google." }, { status: 401 });
  }

  const { to, subject, body } = await req.json().catch(() => ({}));
  if (!to) return NextResponse.json({ error: "Recipient required." }, { status: 400 });

  const raw =
    `To: ${to}\r\n` +
    `Subject: ${subject || "(no subject)"}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
    (body || "");
  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  try {
    const res = await fetch(`${API}/messages/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: encoded }),
    });
    if (!res.ok) throw new Error(await res.text());
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Send failed." }, { status: 502 });
  }
}
