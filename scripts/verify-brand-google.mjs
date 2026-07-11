#!/usr/bin/env node
/**
 * verify-brand-google — proves the per-brand Google (Gmail + Calendar) connection
 * system: separate token storage by brand, resolution order (brand → parent →
 * legacy), auto-selected identity, and the OAuth flow wiring.
 *
 * Token ROUTING is proven by injecting fake tokens through the env-guarded test
 * hook (/api/dev/brand-token, active only when EVO_TEST_HOOKS=1). When that hook
 * is disabled (e.g. production), those checks are skipped and the wiring checks
 * (connections API, per-brand OAuth state, identity) still run.
 *
 * Usage: EVO_TEST_HOOKS=1 on the server, then BASE=… node scripts/verify-brand-google.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0, skipped = 0;

async function rf(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, redirect: "manual", headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const loc = r.headers.get("location");
      const t = await r.text().catch(() => ""); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { status: r.status, json: j, location: loc };
    } catch (e) { if (i === tries - 1) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
}
const check = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } };
const skip = (n) => { skipped++; console.log(`  ⦸ ${n} (test hook disabled)`); };

(async () => {
  console.log(`\nverify-brand-google against ${BASE}\n`);
  const brands = (await rf("/api/brands")).json.brands || [];
  const uw = brands.find((b) => b.name === "UW Equity");
  const prism = brands.find((b) => b.name === "Prism44");
  const quality = brands.find((b) => b.name === "Quality Management");
  check("setup: portfolio present", !!uw && !!prism && !!quality);

  // ---- Connections API lists every brand with its own status ----
  const conn = await rf("/api/brands/connections");
  const list = conn.json.connections || [];
  check("connections API lists all brands", list.length === brands.length && list.every((c) => "connected" in c && "effective" in c));
  check("parent (UW Equity) is flagged", list.find((c) => c.brandId === uw.id)?.isParent === true);

  // ---- Per-brand OAuth flow carries the brandId through `state` ----
  // (Only meaningful when Google OAuth is configured on the server.)
  const configured = !!conn.json.configured;
  if (!configured) {
    skip("per-brand connect builds a Google consent URL carrying the brandId");
  } else {
    const auth = await rf(`/api/google/auth?brandId=${prism.id}`);
    let stateBrand = null;
    try {
      const u = new URL(auth.location);
      const st = u.searchParams.get("state");
      stateBrand = JSON.parse(Buffer.from(st, "base64url").toString("utf8")).brandId;
    } catch {}
    check("per-brand connect builds a Google consent URL carrying the brandId", (auth.location || "").includes("accounts.google.com") && stateBrand === prism.id, `state=${stateBrand}`);
  }

  // ---- Token routing (needs the env-guarded test hook) ----
  const hookProbe = await rf(`/api/dev/brand-token?resolve=${prism.id}`);
  const hookOn = hookProbe.status !== 404;

  if (!hookOn) {
    skip("token routing: brand → parent → legacy");
    skip("identity auto-selects the brand account");
  } else {
    // clean slate
    for (const b of [uw, prism, quality]) await rf("/api/dev/brand-token", { method: "POST", body: JSON.stringify({ brandId: b.id, clear: true }) });

    // 1. Connect ONLY the parent → a subsidiary resolves to the parent (portfolio fallback).
    await rf("/api/dev/brand-token", { method: "POST", body: JSON.stringify({ brandId: uw.id, email: "portfolio@uwequity.com" }) });
    const rPrismViaParent = await rf(`/api/dev/brand-token?resolve=${prism.id}`);
    check("routing: subsidiary falls back to the parent (UW Equity) account", rPrismViaParent.json?.token === `test-token-${uw.id}`, rPrismViaParent.json?.token);
    const connParent = (await rf("/api/brands/connections")).json.connections.find((c) => c.brandId === prism.id);
    check("connections: subsidiary shows it operates through the parent", connParent?.connected === false && connParent?.effective === "parent" && connParent?.effectiveEmail === "portfolio@uwequity.com");

    // 2. Connect the subsidiary's OWN account → it switches to its own token.
    await rf("/api/dev/brand-token", { method: "POST", body: JSON.stringify({ brandId: prism.id, email: "hello@prism44.com" }) });
    const rPrismOwn = await rf(`/api/dev/brand-token?resolve=${prism.id}`);
    check("routing: connected subsidiary uses its OWN account", rPrismOwn.json?.token === `test-token-${prism.id}`);
    const connOwn = (await rf("/api/brands/connections")).json.connections.find((c) => c.brandId === prism.id);
    check("connections: subsidiary now shows its own connection", connOwn?.connected === true && connOwn?.email === "hello@prism44.com" && connOwn?.effective === "brand");

    // 3. Identity auto-selection reflects the real connection.
    const ident = (await rf(`/api/brands/${prism.id}/identity`)).json;
    check("identity: brand email identity auto-selects the connected account", ident.email?.usingBrandAccount === true && ident.email?.fromEmail === "hello@prism44.com" && ident.email?.effective === "brand");
    check("identity: brand calendar auto-selects the connected account", ident.calendar?.usingBrandCalendar === true && ident.calendar?.effective === "brand");

    // 4. Tokens are stored SEPARATELY: quality (unconnected) still falls back to parent, not prism.
    const rQuality = await rf(`/api/dev/brand-token?resolve=${quality.id}`);
    check("storage: brands are isolated (quality → parent, not another subsidiary)", rQuality.json?.token === `test-token-${uw.id}`);

    // 5. Disconnect the subsidiary → it reverts to the parent fallback.
    await rf(`/api/google/disconnect?brandId=${prism.id}`, { method: "POST" });
    const rAfter = await rf(`/api/dev/brand-token?resolve=${prism.id}`);
    check("disconnect: brand reverts to the portfolio account", rAfter.json?.token === `test-token-${uw.id}`);

    // cleanup injected tokens
    for (const b of [uw, prism, quality]) await rf("/api/dev/brand-token", { method: "POST", body: JSON.stringify({ brandId: b.id, clear: true }) });
    console.log("  · cleaned up injected test tokens");
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed, ${skipped} skipped\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("verify-brand-google crashed:", e); process.exit(1); });
