import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, writeTokens } from "@/lib/google";
import { saveGoogleTokens } from "@/lib/server/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve the PUBLIC origin to redirect back to. On a PaaS the app listens on
 * localhost:3000 internally, so `req.url` / `url.origin` is the wrong host.
 * Prefer the proxy's forwarded host, then the configured GOOGLE_REDIRECT_URI
 * origin, and only fall back to the request origin as a last resort.
 */
function publicOrigin(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  if (host && !host.includes("localhost") && !host.startsWith("127.")) {
    return `${proto}://${host}`;
  }
  if (process.env.GOOGLE_REDIRECT_URI) {
    try {
      return new URL(process.env.GOOGLE_REDIRECT_URI).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const base = publicOrigin(req);

  if (error) {
    return NextResponse.redirect(`${base}/connections?google=denied`);
  }
  if (!code) {
    return NextResponse.redirect(`${base}/connections?google=missing_code`);
  }

  try {
    const tokens = await exchangeCode(code);
    writeTokens(tokens); // cookie — Conversation Mode
    await saveGoogleTokens(tokens); // brain — lets background missions act too
    return NextResponse.redirect(`${base}/connections?google=connected`);
  } catch (e: any) {
    const msg = e?.message || String(e);
    // Surfaces in the runtime logs for diagnosis (no secrets in OAuth errors).
    // eslint-disable-next-line no-console
    console.error("[google/callback] OAuth exchange failed:", msg);
    const reason = encodeURIComponent(msg.slice(0, 300));
    return NextResponse.redirect(`${base}/connections?google=failed&reason=${reason}`);
  }
}
