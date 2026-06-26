import { NextRequest, NextResponse } from "next/server";
import { getServerTool } from "@/lib/server/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/tools/[name] — execute one capability against the shared brain.
 * Conversation Mode calls this so its actions persist exactly like a mission's.
 */
export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  const tool = getServerTool(params.name);
  if (!tool) {
    return NextResponse.json({ ok: false, error: `Unknown capability "${params.name}".` }, { status: 404 });
  }
  const args = await req.json().catch(() => ({}));
  try {
    const result = await tool.execute(args || {});
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Capability failed." }, { status: 500 });
  }
}
