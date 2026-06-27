import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, writeTokens } from "@/lib/google";
import { saveGoogleTokens } from "@/lib/server/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const origin = url.origin;

  if (error) {
    return NextResponse.redirect(`${origin}/connections?google=denied`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/connections?google=missing_code`);
  }

  try {
    const tokens = await exchangeCode(code);
    writeTokens(tokens); // cookie — Conversation Mode
    await saveGoogleTokens(tokens); // brain — lets background missions act too
    return NextResponse.redirect(`${origin}/connections?google=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/connections?google=failed`);
  }
}
