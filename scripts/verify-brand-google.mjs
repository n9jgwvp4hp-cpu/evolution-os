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
  const personal = brands.find((b) => b.kind === "personal");
  check("setup: portfolio present", !!uw && !!prism && !!quality);
  check("setup: Personal account exists and is a separate type", !!personal && personal.kind === "personal" && personal.isParent === false && personal.parentId === null);
  check("setup: account types assigned (holding / brand)", uw?.kind === "holding" && prism?.kind === "brand" && quality?.kind === "brand");

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
    skip("token routing + personal/business isolation");
    skip("identity auto-selects the brand account");
  } else {
    const resolve = async (b) => (await rf(`/api/dev/brand-token?resolve=${b.id}`)).json;
    const clearAll = async () => { for (const b of [uw, prism, quality, personal]) await rf("/api/dev/brand-token", { method: "POST", body: JSON.stringify({ brandId: b.id, clear: true }) }); };
    await clearAll();

    // ---- PERSONAL / BUSINESS ISOLATION (the core requirement) ----
    // Connect ONLY the Personal account. A business brand must NOT be able to use it.
    await rf("/api/dev/brand-token", { method: "POST", body: JSON.stringify({ brandId: personal.id, email: "me@personal.com" }) });
    const rPersonal = await resolve(personal);
    check("isolation: personal account resolves to its OWN token", rPersonal.token === `test-token-${personal.id}`);
    const rBizNoLeak = await resolve(prism);
    check("isolation: business brand does NOT borrow the personal account", rBizNoLeak.ok === false, JSON.stringify(rBizNoLeak));
    const rUwNoLeak = await resolve(uw);
    check("isolation: the holding company does NOT borrow the personal account", rUwNoLeak.ok === false);
    const connP = (await rf("/api/brands/connections")).json.connections.find((c) => c.brandId === personal.id);
    check("connections: personal shows its own connection, never 'parent'", connP?.connected === true && connP?.effective === "brand");

    // ---- BUSINESS ROUTING: own → holding (UW Equity) → none ----
    await rf("/api/dev/brand-token", { method: "POST", body: JSON.stringify({ brandId: uw.id, email: "portfolio@uwequity.com" }) });
    const rPrismViaParent = await resolve(prism);
    check("routing: business brand falls back to UW Equity (holding)", rPrismViaParent.token === `test-token-${uw.id}`);
    const connParent = (await rf("/api/brands/connections")).json.connections.find((c) => c.brandId === prism.id);
    check("connections: business brand shows it operates through UW Equity", connParent?.effective === "parent" && connParent?.effectiveEmail === "portfolio@uwequity.com");

    await rf("/api/dev/brand-token", { method: "POST", body: JSON.stringify({ brandId: prism.id, email: "hello@prism44.com" }) });
    check("routing: connected business brand uses its OWN account", (await resolve(prism)).token === `test-token-${prism.id}`);
    const ident = (await rf(`/api/brands/${prism.id}/identity`)).json;
    check("identity: brand email + calendar auto-select the connected account", ident.email?.usingBrandAccount === true && ident.email?.fromEmail === "hello@prism44.com" && ident.calendar?.usingBrandCalendar === true);

    // Disconnect the brand → reverts to UW Equity (NOT personal).
    await rf(`/api/google/disconnect?brandId=${prism.id}`, { method: "POST" });
    check("disconnect: business brand reverts to UW Equity, never personal", (await resolve(prism)).token === `test-token-${uw.id}`);

    // Disconnect UW Equity → business brand has NO account (never personal).
    await rf(`/api/google/disconnect?brandId=${uw.id}`, { method: "POST" });
    check("isolation: with no business connection, brand resolves to NONE (not personal)", (await resolve(prism)).ok === false);

    await clearAll();
    console.log("  · cleaned up injected test tokens");
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed, ${skipped} skipped\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("verify-brand-google crashed:", e); process.exit(1); });
