import { cookies } from "next/headers";

/**
 * Server-side Google OAuth2 helpers for Gmail + Calendar.
 *
 * Tokens are kept in an httpOnly cookie so they're never exposed to the
 * browser. Set these in .env.local to enable the integration:
 *
 *   GOOGLE_CLIENT_ID=...
 *   GOOGLE_CLIENT_SECRET=...
 *   GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback
 *
 * Create credentials at https://console.cloud.google.com/apis/credentials
 * (OAuth client → Web application) and enable the Gmail + Calendar APIs.
 */

const COOKIE = "evo_google";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
];

export type GoogleTokens = {
  access_token: string;
  refresh_token?: string;
  expiry: number; // epoch ms
  email?: string;
};

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/google/callback";
  return { clientId, clientSecret, redirectUri };
}

export function isGoogleConfigured() {
  const { clientId, clientSecret } = googleConfig();
  return Boolean(clientId && clientSecret);
}

/** Build the Google consent-screen URL. */
export function buildAuthUrl(): string {
  const { clientId, redirectUri } = googleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret, redirectUri } = googleConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    // Log the provider's detail server-side only; never surface it to the client
    // (the callback route redirects the message into a user-visible URL param).
    console.error("[google] token exchange failed:", (await res.text().catch(() => "")).slice(0, 300));
    throw new Error("Token exchange failed.");
  }
  const data = await res.json();

  let email: string | undefined;
  try {
    const profile = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    ).then((r) => r.json());
    email = profile.email;
  } catch {
    /* non-fatal */
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
    email,
  };
}

/** Refresh an access token using the stored refresh token. */
async function refresh(tokens: GoogleTokens): Promise<GoogleTokens> {
  const { clientId, clientSecret } = googleConfig();
  if (!tokens.refresh_token) throw new Error("No refresh token available.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error("[google] token refresh failed:", (await res.text().catch(() => "")).slice(0, 300));
    throw new Error("Token refresh failed.");
  }
  const data = await res.json();
  return {
    ...tokens,
    access_token: data.access_token,
    expiry: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export function readTokens(): GoogleTokens | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export function writeTokens(tokens: GoogleTokens) {
  cookies().set(COOKIE, Buffer.from(JSON.stringify(tokens)).toString("base64"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60 days
  });
}

export function clearTokens() {
  cookies().delete(COOKIE);
}

/**
 * Return a valid access token, refreshing + persisting if expired.
 * Throws if the user isn't connected.
 */
export async function getAccessToken(): Promise<string> {
  let tokens = readTokens();
  if (!tokens) throw new Error("Not connected to Google.");
  if (Date.now() > tokens.expiry - 60_000) {
    tokens = await refresh(tokens);
    writeTokens(tokens);
  }
  return tokens.access_token;
}
