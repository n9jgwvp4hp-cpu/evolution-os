import { NextResponse } from "next/server";
import { buildAuthUrl, isGoogleConfigured } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isGoogleConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google isn't configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.",
      },
      { status: 400 }
    );
  }
  return NextResponse.redirect(buildAuthUrl());
}
