import { mutate, read, type GoogleTokens } from "@/lib/server/db";
import { fetchWithTimeout } from "@/lib/server/http";

/**
 * Server-side Google access for the mission worker.
 *
 * Tokens are stored in the brain (persisted by the OAuth callback) so a
 * detached background mission can send mail / create events as the user —
 * without any browser session. Conversation Mode keeps using the cookie-based
 * flow in lib/google.ts; this is the headless counterpart.
 */

function cfg() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  };
}

export async function saveGoogleTokens(tokens: GoogleTokens) {
  await mutate((db) => {
    db.google = tokens;
  });
}
export async function readGoogleTokens(): Promise<GoogleTokens | null> {
  return read((db) => db.google ?? null);
}
export async function isGoogleConnectedServer(): Promise<boolean> {
  return Boolean(await readGoogleTokens());
}

async function refresh(tokens: GoogleTokens): Promise<GoogleTokens> {
  const { clientId, clientSecret } = cfg();
  if (!tokens.refresh_token) throw new Error("No refresh token; reconnect Google.");
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("Google token refresh failed.");
  const data = await res.json();
  return {
    ...tokens,
    access_token: data.access_token,
    expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

// Single-flight: concurrent missions hitting an expired token share ONE refresh
// instead of each POSTing to Google (redundant, and racy on the token write).
let refreshInFlight: Promise<GoogleTokens> | null = null;

/** Valid access token for headless use, refreshing + persisting as needed. */
export async function getServerAccessToken(): Promise<string> {
  const tokens = await readGoogleTokens();
  if (!tokens) throw new Error("Google is not connected.");
  if (Date.now() <= tokens.expiry - 60_000) return tokens.access_token;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const next = await refresh(tokens);
      await saveGoogleTokens(next);
      return next;
    })().finally(() => { refreshInFlight = null; });
  }
  return (await refreshInFlight).access_token;
}
