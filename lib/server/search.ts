/**
 * Web search for missions (competitor / market / acquisition research).
 *
 * Provider priority:
 *   1. Brave Search  — DEFAULT when BRAVE_SEARCH_API_KEY is set (recommended)
 *   2. SerpAPI       — if SERPAPI_KEY is set
 *   3. DuckDuckGo    — keyless HTML fallback (degraded; often rate-limited)
 *
 * Hardening: per-provider RATE LIMITING (Brave free tier = 1 req/sec), bounded
 * RETRIES with exponential backoff on 429/5xx (honoring Retry-After), and
 * structured LOGGING of every search. If the configured provider fails after
 * retries, we fall back to the keyless provider so a research mission degrades
 * instead of dying — and we log that clearly.
 *
 * Everything (web_search tool → competitor/market/acquisition research) routes
 * through runSearch(), so wiring one provider wires them all.
 */

import { fetchWithTimeout as fetchT } from "@/lib/server/http";

export type SearchResult = { title: string; url: string; snippet: string };
export type SearchProvider = "brave" | "serpapi" | "duckduckgo";
export type SearchOutcome = {
  provider: SearchProvider;   // provider that actually served the results
  results: SearchResult[];
  attempts: number;
  degraded: boolean;          // true if we fell back from the configured provider
  error?: string;             // last provider error (if degraded / empty)
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const PLACEHOLDER = /paste|your_?key|xxxx|changeme|^$/i;
const MAX_TRIES = 3;
// Brave free tier allows ~1 request/second. Configurable for higher tiers.
const BRAVE_MIN_INTERVAL_MS = Math.max(0, Number(process.env.BRAVE_SEARCH_MIN_INTERVAL_MS) || 1100);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

/* ---------- configuration ---------- */
function braveKey(): string | null {
  const k = (process.env.BRAVE_SEARCH_API_KEY || "").trim();
  return k && !PLACEHOLDER.test(k) && k.length > 8 ? k : null;
}
function serpKey(): string | null {
  const k = (process.env.SERPAPI_KEY || "").trim();
  return k && !PLACEHOLDER.test(k) && k.length > 8 ? k : null;
}
export function searchProvider(): SearchProvider {
  if (braveKey()) return "brave";
  if (serpKey()) return "serpapi";
  return "duckduckgo";
}
/** For the health/status UI. */
export function searchStatus() {
  const provider = searchProvider();
  return {
    provider,
    configured: provider !== "duckduckgo",
    braveKeyPresent: !!braveKey(),
    rateLimitMs: BRAVE_MIN_INTERVAL_MS,
  };
}

/* ---------- logging ---------- */
function log(msg: string, extra: Record<string, any> = {}) {
  const kv = Object.entries(extra).map(([k, v]) => `${k}=${typeof v === "string" ? JSON.stringify(v.slice?.(0, 60) ?? v) : v}`).join(" ");
  // eslint-disable-next-line no-console
  console.log(`[search] ${msg}${kv ? " " + kv : ""}`);
}

/* ---------- rate limiting (serialize + space out provider calls) ---------- */
let braveChain: Promise<unknown> = Promise.resolve();
let lastBraveAt = 0;
function braveRateLimited<T>(fn: () => Promise<T>): Promise<T> {
  const run = braveChain.then(async () => {
    const wait = Math.max(0, BRAVE_MIN_INTERVAL_MS - (Date.now() - lastBraveAt));
    if (wait) await sleep(wait);
    lastBraveAt = Date.now();
    return fn();
  });
  braveChain = run.then(() => undefined, () => undefined); // keep the chain alive through errors
  return run as Promise<T>;
}

/* ---------- retry wrapper ---------- */
class HttpError extends Error {
  status: number; retryAfterMs?: number;
  constructor(status: number, message: string, retryAfterMs?: number) { super(message); this.status = status; this.retryAfterMs = retryAfterMs; }
}
async function withRetry<T>(label: string, fn: (attempt: number) => Promise<T>): Promise<{ value: T; attempts: number }> {
  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt };
    } catch (e: any) {
      lastErr = e;
      const status = e instanceof HttpError ? e.status : 0;
      const retryable = status === 429 || (status >= 500 && status < 600) || status === 0;
      if (!retryable || attempt === MAX_TRIES) break;
      const backoff = e?.retryAfterMs ?? Math.round(500 * 2 ** (attempt - 1) * (0.85 + Math.random() * 0.3));
      log(`retry ${label}`, { attempt, status, waitMs: backoff, err: String(e?.message || e) });
      await sleep(backoff);
    }
  }
  throw lastErr;
}

/* ---------- providers ---------- */
async function braveSearch(query: string, count: number): Promise<SearchResult[]> {
  const key = braveKey()!;
  return braveRateLimited(async () => {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(count, 20)));
    const res = await fetchT(url, { headers: { Accept: "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": key } }, 12_000);
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const body = (await res.text().catch(() => "")).slice(0, 160);
      throw new HttpError(res.status, `Brave ${res.status}: ${body}`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
    }
    const data = await res.json();
    return (data.web?.results ?? []).slice(0, count).map((r: any) => ({
      title: r.title || "", url: r.url || "", snippet: r.description ? strip(r.description) : "",
    }));
  });
}
async function serpapiSearch(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", query); url.searchParams.set("engine", "google");
  url.searchParams.set("num", String(Math.min(count, 20))); url.searchParams.set("api_key", serpKey()!);
  const res = await fetchT(url, {}, 12_000);
  if (!res.ok) throw new HttpError(res.status, `SerpAPI ${res.status}`);
  const data = await res.json();
  return (data.organic_results ?? []).slice(0, count).map((r: any) => ({ title: r.title || "", url: r.link || "", snippet: r.snippet || "" }));
}
async function duckSearch(query: string, count: number): Promise<SearchResult[]> {
  const res = await fetchT("https://html.duckduckgo.com/html/", {
    method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }),
  }, 12_000);
  if (!res.ok) throw new HttpError(res.status, `DuckDuckGo ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = []; let s: RegExpExecArray | null;
  while ((s = snippetRe.exec(html))) snippets.push(strip(s[1]));
  let m: RegExpExecArray | null; let i = 0;
  while ((m = linkRe.exec(html)) && results.length < count) {
    let href = m[1];
    if (/duckduckgo\.com\/y\.js|ad_domain=|ad_provider=/.test(href)) { i++; continue; }
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]); else if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href)) { i++; continue; }
    results.push({ title: strip(m[2]), url: href, snippet: snippets[i] || "" }); i++;
  }
  return results;
}

const RUN: Record<SearchProvider, (q: string, c: number) => Promise<SearchResult[]>> = {
  brave: braveSearch, serpapi: serpapiSearch, duckduckgo: duckSearch,
};

/* ---------- public API ---------- */
/** Run a search through the configured provider, with retries + rate limiting +
 *  logging, falling back to the keyless provider on hard failure. */
export async function runSearch(query: string, count = 8): Promise<SearchOutcome> {
  const primary = searchProvider();
  const t0 = Date.now();
  try {
    const { value, attempts } = await withRetry(primary, () => RUN[primary](query, count));
    log("ok", { provider: primary, query, count: value.length, ms: Date.now() - t0, attempts });
    return { provider: primary, results: value, attempts, degraded: false };
  } catch (e: any) {
    const err = String(e?.message || e);
    log("provider failed", { provider: primary, query, ms: Date.now() - t0, err });
    if (primary !== "duckduckgo") {
      try {
        const { value, attempts } = await withRetry("duckduckgo", () => duckSearch(query, count));
        log("fallback ok", { provider: "duckduckgo", query, count: value.length });
        return { provider: "duckduckgo", results: value, attempts, degraded: true, error: err };
      } catch (e2: any) {
        log("fallback failed", { provider: "duckduckgo", err: String(e2?.message || e2) });
        return { provider: primary, results: [], attempts: MAX_TRIES, degraded: true, error: err };
      }
    }
    return { provider: primary, results: [], attempts: MAX_TRIES, degraded: false, error: err };
  }
}

/** Back-compat: results only. */
export async function searchWeb(query: string, count = 8): Promise<SearchResult[]> {
  return (await runSearch(query, count)).results;
}
