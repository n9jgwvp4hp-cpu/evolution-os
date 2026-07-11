#!/usr/bin/env node
/**
 * verify-search — proves external search + the research→note→tree flow.
 *  1. Reports the active search provider (brave when the key is set).
 *  2. Calls web_search directly (real) and reports provider + result count.
 *  3. Plants a 2-node dependency tree: node A searches the web + saves a note;
 *     when A completes, node B auto-spawns — proving a mission can search, save
 *     notes, and continue its dependency tree automatically.
 * Cleans up. Usage: BASE=https://<host> node scripts/verify-search.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rf(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { status: r.status, json: j };
    } catch (e) { if (i === tries - 1) throw e; await sleep(800 * (i + 1)); }
  }
}
const check = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } };

(async () => {
  console.log(`\nverify-search against ${BASE}\n`);
  const tag = `SearchTest ${Date.now()}`;

  // 1. Provider from health.
  const health = (await rf("/api/ops")).json.health || {};
  const provider = /(\w+) configured/.exec(health.search?.detail || "")?.[1] || (health.search?.status === "ok" ? "configured" : "duckduckgo");
  console.log(`Search provider: ${health.search?.detail} (status: ${health.search?.status})`);
  check("search status is surfaced in health", !!health.search);

  // 2. Direct real web_search.
  const ws = (await rf("/api/tools/web_search", { method: "POST", body: JSON.stringify({ query: "commercial real estate market trends 2026", count: 5 }) })).json;
  console.log(`web_search → provider=${ws.provider} count=${ws.count}${ws.degraded ? " (degraded)" : ""}${ws.note ? " · " + ws.note : ""}`);
  check("web_search tool executes and returns a provider", ws.ok === true && !!ws.provider);
  const braveLive = ws.provider === "brave" && (ws.count || 0) > 0;
  if (braveLive) check("Brave Search is returning real results", true);
  else console.log(`  ⦸ Brave not returning results yet (provider=${ws.provider}). Paste BRAVE_SEARCH_API_KEY, then re-run.`);

  // 3. Mission flow: search → note → tree continues.
  const brands = (await rf("/api/brands")).json.brands || [];
  const prism = brands.find((b) => b.name === "Prism44");
  const chain = [
    `Search the web with web_search for "commercial real estate market trends 2026", then save a note titled "${tag} A" summarizing findings (or noting if search returned nothing). Use only web_search and notes.`,
    `Save a note titled "${tag} B" confirming the previous research step completed.`,
  ];
  const plant = (await rf("/api/mission-trees", { method: "POST", body: JSON.stringify({ chain, brandId: prism?.id }) })).json;
  const rootId = plant.rootId;
  check("planted a research dependency tree", !!rootId);

  let tree = null;
  for (let i = 0; i < 40; i++) {
    await sleep(6000);
    tree = (await rf(`/api/mission-trees/${rootId}`)).json;
    const c = tree.counts || {};
    if ((c.done || 0) >= 2 || c.failed) break;
  }
  const flat = [];
  (function walk(n) { if (!n) return; if (n.id) flat.push(n); (n.children || []).forEach(walk); })(tree?.tree);
  const rootNode = flat.find((n) => n.id === rootId);
  const childNode = flat.find((n) => n.parentMissionId === rootId) || flat.find((n) => n.id !== rootId);

  check("research mission (node A) completed", rootNode?.status === "done", rootNode?.status);
  // node A actually called web_search
  const aDetail = rootId ? (await rf(`/api/missions/${rootId}`)).json.mission : null;
  const aActions = (aDetail?.steps || []).filter((s) => s.kind === "action").map((s) => s.text);
  check("node A actually called web_search", aActions.some((t) => /search web/i.test(t)), aActions.join(", "));
  // note saved
  const notes = (await rf("/api/data/notes")).json.items || [];
  check("node A saved a note", notes.some((n) => n.title === `${tag} A`));
  // tree continued: child spawned + done
  check("dependency tree continued automatically (node B auto-spawned)", !!childNode && childNode.id !== rootId);
  check("node B completed after node A", childNode?.status === "done", childNode?.status);
  check("node B saved its note", notes.some((n) => n.title === `${tag} B`));

  // cleanup: delete tree missions + test notes
  for (const n of flat) if (n.id) await rf(`/api/missions/${n.id}`, { method: "DELETE" }).catch(() => {});
  const keep = notes.filter((n) => !String(n.title || "").startsWith(tag));
  if (keep.length !== notes.length) await rf("/api/data/notes", { method: "PUT", body: JSON.stringify({ items: keep }) });
  console.log("  · cleaned up test tree + notes");

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
  console.log(braveLive ? "Brave Search is live. ✅\n" : "Flow verified. Add BRAVE_SEARCH_API_KEY to enable real web results.\n");
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("verify-search crashed:", e); process.exit(1); });
