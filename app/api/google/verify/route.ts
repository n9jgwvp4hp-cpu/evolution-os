import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnostic: verify the credentials the SERVER is actually using, against
 * Google, without exposing secret values. The client_id is public (returned in
 * full); the secret is described only by shape (prefix/length), never its value.
 *
 * A dummy authorization-code exchange distinguishes:
 *   invalid_grant  → client_id + secret are VALID (only the dummy code failed)
 *   invalid_client → the deployed credentials are WRONG
 */
export async function GET() {
  const id = process.env.GOOGLE_CLIENT_ID || "";
  const secret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirect = process.env.GOOGLE_REDIRECT_URI || "";

  // Full credential surface the running process sees (KEY NAMES ONLY, no values)
  // — proves no alternate/correct secret var is hiding anywhere in the env.
  const credEnvKeys = Object.keys(process.env)
    .filter((k) => /GOOGLE|OAUTH|CLIENT|SECRET/i.test(k))
    .sort();

  const diag = {
    client_id: id, // public value — safe to show
    client_id_valid_shape: id.endsWith(".apps.googleusercontent.com"),
    client_id_looks_like_secret: id.startsWith("GOCSPX-"), // ← swap indicator
    secret_present: secret.length > 0,
    secret_starts_GOCSPX: secret.startsWith("GOCSPX-"),
    secret_looks_like_client_id: secret.endsWith(".apps.googleusercontent.com"), // ← swap indicator
    secret_length: secret.length,
    secret_or_id_has_whitespace: /\s/.test(secret) || /\s/.test(id),
    redirect_uri: redirect,
  };

  let google_verdict = "unknown";
  let google_error = "";
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "evolution_server_precheck",
        redirect_uri: redirect,
        client_id: id,
        client_secret: secret,
      }),
    });
    const data = await res.json().catch(() => ({}));
    google_error = data.error || "";
    google_verdict =
      data.error === "invalid_grant"
        ? "CREDENTIALS_VALID"
        : data.error === "invalid_client"
        ? "CREDENTIALS_INVALID"
        : `other (${data.error || res.status})`;
  } catch (e: any) {
    google_verdict = "probe_failed";
    google_error = e?.message || "network error";
  }

  return NextResponse.json({ google_verdict, google_error, credEnvKeys, diag });
}
