#!/usr/bin/env node
/**
 * run-tree — plants ONE real dependency tree (the multifamily acquisition chain)
 * on the "Acquire multifamily properties" objective and watches the real engine
 * expand it: each node materializes its child only after it completes. No fake
 * data — every node is a real mission executed by the worker.
 *
 * Usage: BASE=https://<host> WATCH_S=300 node scripts/run-tree.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
const WATCH_S = Number(process.env.WATCH_S) || 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rf(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { status: r.status, json: j };
    } catch (e) { if (i === tries - 1) throw e; await sleep(700 * (i + 1)); }
  }
}

// The user's exact chain, with light real-work context per node.
const CHAIN = [
  "Define investment criteria for multifamily acquisitions: target markets, unit count, cap-rate range, and budget. Save a note 'Investment Criteria' summarizing them.",
  "Build an acquisition pipeline for multifamily deals: outline sourcing channels and a tracking framework. Save a note 'Acquisition Pipeline'.",
  "Find multifamily opportunities that match the criteria: research markets and list candidate deal types with sources. Save a note 'Opportunities Shortlist'.",
  "Underwrite the shortlisted deals: estimate rents, expenses, and cap rate at a high level. Save a note 'Underwriting'.",
  "Schedule intro calls with brokers/sellers for the top deals.",
  "Submit offers on the best-underwritten deals: draft the key offer terms. Save a note 'Offer Terms'.",
  "Run due diligence on accepted offers: prepare a diligence checklist. Save a note 'Due Diligence Checklist'.",
  "Coordinate closing for the deal: prepare a closing checklist. Save a note 'Closing Checklist'.",
];

const ICON = { done: "✅", running: "🔵", queued: "🟡", needs_approval: "🟣", failed: "⛔", paused: "⏸️", not_created: "▫️" };
function render(node, depth = 0) {
  const pad = "   ".repeat(depth) + (depth ? "└─ " : "");
  const tag = node.pending ? `${ICON.not_created} (pending) ${node.objective.slice(0, 58)}`
    : `${ICON[node.status] || "•"} [${node.status}${node.progress ? ` ${node.progress}%` : ""}] ${node.objective.slice(0, 58)}`;
  console.log(pad + tag);
  for (const c of node.children || []) render(c, depth + 1);
}

(async () => {
  console.log(`\n=== Planting a real dependency tree · ${BASE} ===\n`);
  const brands = (await rf("/api/brands")).json.brands || [];
  const uw = brands.find((b) => b.name === "UW Equity");
  const objs = (await rf("/api/objectives")).json.objectives || [];
  const obj = objs.find((o) => o.title === "Acquire multifamily properties") || objs.find((o) => o.brandId === uw?.id);
  console.log(`Objective: ${obj?.title}  ·  Brand: ${uw?.name}\n`);

  const plant = await rf("/api/mission-trees", { method: "POST", body: JSON.stringify({ chain: CHAIN, brandId: uw?.id, objectiveId: obj?.id }) });
  const rootId = plant.json?.rootId;
  if (!rootId) { console.error("Failed to plant tree:", JSON.stringify(plant.json)); process.exit(1); }
  console.log(`Planted. Root mission = ${rootId}. Watching the engine expand it…\n`);

  const started = Date.now();
  let last = "";
  while ((Date.now() - started) / 1000 < WATCH_S) {
    const t = (await rf(`/api/mission-trees/${rootId}`)).json;
    const sig = JSON.stringify(t.counts) + t.pending;
    if (sig !== last) {
      last = sig;
      console.log(`\n── t+${Math.round((Date.now() - started) / 1000)}s · realized=${t.realized} pending=${t.pending} · ${JSON.stringify(t.counts)} ──`);
      render(t.tree);
    }
    // stop early once the frontier is stuck (approval/blocked) or the tree is fully done
    const c = t.counts || {};
    const open = (c.queued || 0) + (c.running || 0);
    if (t.pending === 0 && open === 0) { console.log("\n(tree reached a terminal frontier — done or awaiting approval)"); break; }
    await sleep(10_000);
  }

  const fin = (await rf(`/api/mission-trees/${rootId}`)).json;
  console.log(`\n\n================= FINAL TREE (real engine) =================`);
  console.log(`root=${rootId} · realized nodes=${fin.realized} · pending seeds=${fin.pending} · status counts=${JSON.stringify(fin.counts)}`);
  render(fin.tree);
  console.log(`\nView it live: ${BASE}/api/mission-trees/${rootId}\n`);
})().catch((e) => { console.error("run-tree crashed:", e); process.exit(1); });
