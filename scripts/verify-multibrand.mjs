#!/usr/bin/env node
/**
 * verify-multibrand — proves the multi-brand architecture.
 *
 * Covers: (1) Brand model + portfolio seed (UW Equity parent + Prism44 + Quality
 * Management), (2) brand switcher backing (active brand get/set), (3) brand CRUD,
 * (4) separate CRM pipelines by brand (brandId filtering), (5) lead-source
 * tracking, (6) brand-specific onboarding forms → brand-scoped leads, (7) the UW
 * Equity portfolio dashboard aggregation. Cleans up everything it creates.
 *
 * Usage: BASE=https://<host> node scripts/verify-multibrand.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const made = { brandId: null, formId: null, contactIds: [] };

async function rf(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { status: r.status, json: j };
    } catch (e) { if (i === tries - 1) throw e; await new Promise((s) => setTimeout(s, 800 * (i + 1))); }
  }
}
const check = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } };

(async () => {
  console.log(`\nverify-multibrand against ${BASE}\n`);

  // --- 1. Portfolio seed + Brand model ---
  const bl = await rf("/api/brands");
  const brands = bl.json.brands || [];
  const parent = brands.find((b) => b.isParent);
  const prism = brands.find((b) => b.name === "Prism44");
  const quality = brands.find((b) => b.name === "Quality Management");
  check("portfolio seeded (UW Equity + Prism44 + Quality Management)", !!parent && parent.name === "UW Equity" && !!prism && !!quality);
  check("parent is the holding company (no parentId)", parent?.parentId == null && parent?.isParent === true);
  check("subsidiaries point to the parent", prism?.parentId === parent?.id && quality?.parentId === parent?.id);
  check("Brand model has all fields", prism && Array.isArray(prism.instagramAccounts) && Array.isArray(prism.emailAccounts) && Array.isArray(prism.services) && !!prism.colors?.primary && Array.isArray(prism.leadSources) && "domain" in prism && "logo" in prism);

  // --- 2. Brand switcher backing (active brand) ---
  const a0 = await rf("/api/brands/active");
  check("active brand defaults to the parent", a0.json.activeBrandId === parent?.id, a0.json.activeBrandId);
  await rf("/api/brands/active", { method: "PUT", body: JSON.stringify({ brandId: prism.id }) });
  const a1 = await rf("/api/brands/active");
  check("active brand can be switched", a1.json.activeBrandId === prism.id);
  await rf("/api/brands/active", { method: "PUT", body: JSON.stringify({ brandId: parent.id }) }); // restore

  // --- 3. Brand CRUD ---
  const c = await rf("/api/brands", { method: "POST", body: JSON.stringify({ name: "Verify Co" }) });
  made.brandId = c.json?.brand?.id;
  check("create brand → subsidiary of parent", !!made.brandId && c.json.brand.parentId === parent.id && c.json.brand.isParent === false);
  const patch = await rf(`/api/brands/${made.brandId}`, { method: "PATCH", body: JSON.stringify({ domain: "verify.co", services: ["Consulting"], instagramAccounts: ["@verifyco"], colors: { primary: "#ff0000" }, leadSources: ["website", "ads"] }) });
  check("patch brand fields", patch.json?.brand?.domain === "verify.co" && patch.json.brand.services[0] === "Consulting" && patch.json.brand.colors.primary === "#ff0000");
  const delParent = await rf(`/api/brands/${parent.id}`, { method: "DELETE" });
  check("parent holding company cannot be deleted", delParent.json?.ok === false);

  // --- 4/5/6. Onboarding form → brand-scoped lead with lead-source ---
  const forms = await rf(`/api/onboarding?brandId=${prism.id}`);
  const form = (forms.json.forms || [])[0];
  check("Prism44 has a default onboarding form", !!form && form.brandId === prism.id, JSON.stringify(forms.json).slice(0, 120));
  made.formId = form?.id;
  // map field ids for name/email
  const nameField = form.fields.find((f) => f.mapsTo === "name");
  const emailField = form.fields.find((f) => f.mapsTo === "email");
  const sub = await rf(`/api/onboarding/${form.id}/submit`, {
    method: "POST",
    body: JSON.stringify({ data: { [nameField.id]: "MB Probe Lead", [emailField.id]: "probe@verify.co" }, leadSource: "instagram" }),
  });
  check("form submission creates a lead", sub.json?.ok === true && !!sub.json.contactId, JSON.stringify(sub.json).slice(0, 120));
  if (sub.json?.contactId) made.contactIds.push(sub.json.contactId);
  check("submission is attributed to the brand", sub.json?.brandId === prism.id);

  // --- 4. Separate CRM pipelines by brand (brandId filter) ---
  const prismContacts = await rf(`/api/data/contacts?brandId=${prism.id}`);
  const lead = (prismContacts.json.items || []).find((x) => x.id === sub.json.contactId);
  check("lead appears in Prism44's scoped pipeline", !!lead);
  check("lead carries brandId + lead-source (instagram)", lead?.brandId === prism.id && lead?.leadSource === "instagram");
  const qualityContacts = await rf(`/api/data/contacts?brandId=${quality.id}`);
  check("lead does NOT appear in another brand's pipeline", !(qualityContacts.json.items || []).some((x) => x.id === sub.json.contactId));
  const allContacts = await rf(`/api/data/contacts`);
  check("unscoped CRM still returns everything (back-compat preserved)", (allContacts.json.items || []).some((x) => x.id === sub.json.contactId));

  // projects is now a valid server collection
  const proj = await rf(`/api/data/projects`);
  check("projects is a server-backed collection", proj.status === 200 && Array.isArray(proj.json.items));

  // --- 7. UW Equity portfolio dashboard ---
  const dash = await rf("/api/uw-equity");
  const d = dash.json;
  check("dashboard aggregates the portfolio", d?.ok === true && !!d.portfolio && Array.isArray(d.brands));
  check("dashboard exposes all six tiles", d.portfolio && "activeMissions" in d.portfolio && "leads" in d.portfolio && "revenue" in d.portfolio && "projects" in d.portfolio && "blockers" in d.portfolio && "leadsBySource" in d.portfolio);
  const prismAgg = d.brands.find((b) => b.id === prism.id);
  check("Prism44 rollup counts the new lead by source", prismAgg && prismAgg.leads.total >= 1 && prismAgg.leads.bySource.instagram >= 1, JSON.stringify(prismAgg?.leads));
  check("portfolio leads reflect the subsidiary lead", d.portfolio.leads >= 1 && d.portfolio.leadsBySource.instagram >= 1);

  // --- Cleanup ---
  if (made.contactIds.length) {
    const cur = await rf(`/api/data/contacts`);
    const kept = (cur.json.items || []).filter((x) => !made.contactIds.includes(x.id));
    await rf(`/api/data/contacts`, { method: "PUT", body: JSON.stringify({ items: kept }) });
  }
  if (made.brandId) await rf(`/api/brands/${made.brandId}`, { method: "DELETE" });
  console.log("  · cleaned up probe brand + lead");

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("verify-multibrand crashed:", e); process.exit(1); });
