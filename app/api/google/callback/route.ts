import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, writeTokens } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const origin = url.origin;

  if (error) {
    return NextResponse.redirect(`${origin}/settings?google=denied`);
  }
  if (!code) {
    return NextResponse.redirect(`${origin}/settings?google=missing_code`);
  }

  try {
    const tokens = await exchangeCode(code);
    writeTokens(tokens);
    return NextResponse.redirect(`${origin}/settings?google=connected`);
  } catch {
    return NextResponse.redirect(`${origin}/settings?google=failed`);
  }
}
