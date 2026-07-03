import { NextRequest, NextResponse } from "next/server";
import { listKind, replaceKind, isBrainKind } from "@/lib/server/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/data/[kind] — read a whole collection from the shared brain. */
export async function GET(_req: NextRequest, { params }: { params: { kind: string } }) {
  if (!isBrainKind(params.kind)) {
    return NextResponse.json({ error: "Unknown collection." }, { status: 404 });
  }
  return NextResponse.json({ items: await listKind(params.kind) });
}

/** PUT /api/data/[kind] — replace a whole collection (module views save here). */
export async function PUT(req: NextRequest, { params }: { params: { kind: string } }) {
  if (!isBrainKind(params.kind)) {
    return NextResponse.json({ error: "Unknown collection." }, { status: 404 });
  }
  // A malformed body must NOT be treated as an empty collection — that would
  // silently wipe stored data. Require an explicit array (an empty array is a
  // legitimate "delete everything" the user performed in the module view).
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Body must be { items: [...] }." }, { status: 400 });
  }
  return NextResponse.json(await replaceKind(params.kind, body.items));
}
