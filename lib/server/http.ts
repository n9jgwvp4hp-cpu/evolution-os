/**
 * Outbound HTTP with a hard timeout.
 *
 * Every server-side call to a third party (OpenAI, Google, search providers,
 * arbitrary pages) MUST be bounded: a mission runs on the worker holding one of
 * only MAX_CONCURRENT execution slots, so a single hung request would stall that
 * slot indefinitely and, repeated, starve the whole worker. This is the one
 * place that guarantee lives.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  ms = 15_000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** True when an error is an abort from fetchWithTimeout hitting its deadline. */
export function isTimeout(e: any): boolean {
  return e?.name === "AbortError";
}
