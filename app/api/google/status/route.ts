import { NextResponse } from "next/server";
import { readTokens, isGoogleConfigured } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const tokens = readTokens();
  return NextResponse.json({
    configured: isGoogleConfigured(),
    connected: Boolean(tokens),
    email: tokens?.email ?? null,
  });
}
