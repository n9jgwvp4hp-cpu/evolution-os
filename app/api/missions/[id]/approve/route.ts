import { NextRequest, NextResponse } from "next/server";
import { approveMission } from "@/lib/server/missionEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — resolve a paused mission's approval request, then it resumes server-side. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { approved } = await req.json().catch(() => ({ approved: false }));
  await approveMission(params.id, Boolean(approved));
  return NextResponse.json({ ok: true });
}
