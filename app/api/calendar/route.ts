import { NextRequest, NextResponse } from "next/server";
import { getAccessToken } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** GET — upcoming events for the next ~30 days. */
export async function GET() {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return NextResponse.json({ error: "Not connected to Google." }, { status: 401 });
  }

  const now = new Date();
  const url = new URL(API);
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("maxResults", "20");
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");

  try {
    const data = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());

    const events = (data.items ?? []).map((e: any) => ({
      id: e.id,
      summary: e.summary || "(no title)",
      location: e.location || "",
      start: e.start?.dateTime || e.start?.date || "",
      end: e.end?.dateTime || e.end?.date || "",
      allDay: Boolean(e.start?.date),
      link: e.htmlLink || "",
    }));
    return NextResponse.json({ events });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Calendar request failed." }, { status: 502 });
  }
}

/** POST — create an event { summary, start, end, location, description }. */
export async function POST(req: NextRequest) {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return NextResponse.json({ error: "Not connected to Google." }, { status: 401 });
  }

  const { summary, start, end, location, description } = await req.json().catch(() => ({}));
  if (!summary || !start) {
    return NextResponse.json({ error: "Title and start time required." }, { status: 400 });
  }

  // Default to a 1-hour event when no end is given.
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 60 * 60 * 1000);

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary,
        location: location || undefined,
        description: description || undefined,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const event = await res.json();
    return NextResponse.json({ ok: true, id: event.id, link: event.htmlLink });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Create failed." }, { status: 502 });
  }
}
