/**
 * Web search for missions.
 *
 * Provider abstraction so research works today with no account, and upgrades
 * automatically to a real search API when a key is present:
 *   1. Brave Search   — if BRAVE_SEARCH_API_KEY is set
 *   2. SerpAPI/Google — if SERPAPI_KEY is set
 *   3. DuckDuckGo     — keyless HTML fallback (default; no credentials)
 *
 * Returns normalized results: { title, url, snippet }.
 */

import { fetchWithTimeout as fetchT } from "@/lib/server/http";

export type SearchResult = { title: string; url: string; snippet: string };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchProvider(): string {
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.SERPAPI_KEY) return "serpapi";
  return "duckduckgo";
}

async function braveSearch(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(count, 20)));
  const res = await fetchT(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY! },
  });
  if (!res.ok) throw new Error(`Brave search failed (${res.status}).`);
  const data = await res.json();
  return (data.web?.results ?? []).slice(0, count).map((r: any) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.description ? strip(r.description) : "",
  }));
}

async function serpapiSearch(query: string, count: number): Promise<SearchResult[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("engine", "google");
  url.searchParams.set("num", String(Math.min(count, 20)));
  url.searchParams.set("api_key", process.env.SERPAPI_KEY!);
  const res = await fetchT(url);
  if (!res.ok) throw new Error(`SerpAPI failed (${res.status}).`);
  const data = await res.json();
  return (data.organic_results ?? []).slice(0, count).map((r: any) => ({
    title: r.title || "",
    url: r.link || "",
    snippet: r.snippet || "",
  }));
}

/** Keyless fallback: scrape DuckDuckGo's HTML endpoint. */
async function duckSearch(query: string, count: number): Promise<SearchResult[]> {
  const res = await fetchT("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ q: query }),
  });
  if (!res.ok) throw new Error(`DuckDuckGo failed (${res.status}).`);
  const html = await res.text();

  const results: SearchResult[] = [];
  // Each result anchor: class="result__a" href="...uddg=<encoded target>..."
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let s: RegExpExecArray | null;
  while ((s = snippetRe.exec(html))) snippets.push(strip(s[1]));

  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(html)) && results.length < count) {
    let href = m[1];
    // Skip DuckDuckGo ad/redirect units — keep only organic results.
    if (/duckduckgo\.com\/y\.js|ad_domain=|ad_provider=/.test(href)) { i++; continue; }
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    else if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href)) { i++; continue; }
    results.push({ title: strip(m[2]), url: href, snippet: snippets[i] || "" });
    i++;
  }
  return results;
}

export async function searchWeb(query: string, count = 8): Promise<SearchResult[]> {
  const provider = searchProvider();
  if (provider === "brave") return braveSearch(query, count);
  if (provider === "serpapi") return serpapiSearch(query, count);
  return duckSearch(query, count);
}
