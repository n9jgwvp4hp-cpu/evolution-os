import { NextResponse } from "next/server";
import { clearTokens } from "@/lib/google";
import { saveGoogleTokens } from "@/lib/server/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  clearTokens();
  await saveGoogleTokens(null as any); // also revoke the worker's access
  return NextResponse.json({ ok: true });
}
