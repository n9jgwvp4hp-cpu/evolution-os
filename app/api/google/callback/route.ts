import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, writeTokens } from "@/lib/google";
import { saveGoogleTokens } from "@/lib/server/google";
import { saveBrandTokens } from "@/lib/server/brandGoogle";

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
  const stateRaw = url.searchParams.get("state");
  const base = publicOrigin(req);

  // Decode the target brand (if this was a per-brand connect).
  let brandId: string | null = null;
  if (stateRaw) {
    try { brandId = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8")).brandId ?? null; } catch { /* ignore */ }
  }
  const done = (q: string) => `${base}/connections?google=${q}${brandId ? `&brandId=${brandId}` : ""}`;

  if (error) return NextResponse.redirect(done("denied"));
  if (!code) return NextResponse.redirect(done("missing_code"));

  try {
    const tokens = await exchangeCode(code);
    writeTokens(tokens); // cookie — Conversation Mode
    if (brandId) {
      // Per-brand connection: store under this brand (also syncs legacy when parent).
      await saveBrandTokens(brandId, tokens);
    } else {
      await saveGoogleTokens(tokens); // legacy single-account path
    }
    return NextResponse.redirect(done("connected"));
  } catch (e: any) {
    const msg = e?.message || String(e);
    // Surfaces in the runtime logs for diagnosis (no secrets in OAuth errors).
    // eslint-disable-next-line no-console
    console.error("[google/callback] OAuth exchange failed:", msg);
    const reason = encodeURIComponent(msg.slice(0, 300));
    return NextResponse.redirect(`${base}/connections?google=failed&reason=${reason}`);
  }
}
