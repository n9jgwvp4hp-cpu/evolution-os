#!/usr/bin/env node
/**
 * run-grow-prism44 — real autonomy test. Plants a dependency tree on the
 * "Grow Prism44" objective that must do actual work with connected tools only
 * (research → notes → onboarding questions → outreach drafts → timeline), runs it
 * on the real engine, then inspects each node's ACTUAL tool calls so we can say
 * exactly what truly executed, what needed approval, and what is placeholder.
 */
const BASE = process.env.BASE || "http://localhost:3000";
const WATCH_S = Number(process.env.WATCH_S) || 320;
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

// Each node maps to one allowed action, and is explicitly instructed to be honest
// about tool results (so the mission's own output can't fake success).
const CHAIN = [
  "Research Prism44's competitors using connected tools ONLY: call web_search for competitors, and fetch_url to read any result URLs. Compile a ranked competitor list. Save a note titled 'Prism44 — Competitor Research'. CRITICAL: if web_search returns no results, state that explicitly in the note; only claim a competitor was verified if you actually fetched a source URL. Do not fabricate sources.",
  "Generate onboarding intake questions for new Prism44 clients: write 10 concrete questions. Save them in a note titled 'Prism44 — Onboarding Questions'.",
  "Draft two short outreach messages for Prism44 prospects. Save them in a note titled 'Prism44 — Outreach Drafts'. If a connected Gmail draft tool works, also create a real draft; if Gmail is not connected, say so in the note and just save the text. Do NOT send anything.",
  "Update the growth timeline: save a note titled 'Prism44 — Growth Timeline' summarizing each step completed in this tree and its real status.",
];

const ICON = { done: "✅", running: "🔵", queued: "🟡", needs_approval: "🟣", failed: "⛔", paused: "⏸️", not_created: "▫️" };
function render(node, depth = 0) {
  const pad = "   ".repeat(depth) + (depth ? "└─ " : "");
  console.log(pad + (node.pending ? `${ICON.not_created} (pending) ${node.objective.slice(0, 56)}`
    : `${ICON[node.status] || "•"} [${node.status}${node.progress ? ` ${node.progress}%` : ""}] ${node.objective.slice(0, 56)}`));
  for (const c of node.children || []) render(c, depth + 1);
}
function flatten(node, out = []) { out.push(node); (node.children || []).forEach((c) => flatten(c, out)); return out; }

(async () => {
  console.log(`\n=== REAL AUTONOMY TEST · Grow Prism44 · ${BASE} ===\n`);
  const brands = (await rf("/api/brands")).json.brands || [];
  const prism = brands.find((b) => b.name === "Prism44");
  const obj = ((await rf("/api/objectives")).json.objectives || []).find((o) => o.title === "Grow Prism44");
  const conn = ((await rf("/api/brands/connections")).json.connections || []).find((c) => c.brandId === prism?.id);
  console.log(`Brand: Prism44 · Objective: ${obj?.title} · Google connected for Prism44: ${conn?.connected ? "YES" : "NO (" + conn?.effective + ")"}\n`);

  const plant = await rf("/api/mission-trees", { method: "POST", body: JSON.stringify({ chain: CHAIN, brandId: prism?.id, objectiveId: obj?.id }) });
  const rootId = plant.json?.rootId;
  if (!rootId) { console.error("plant failed:", JSON.stringify(plant.json)); process.exit(1); }
  console.log(`Planted root ${rootId}. Executing on the real engine…\n`);

  const started = Date.now(); let last = "";
  while ((Date.now() - started) / 1000 < WATCH_S) {
    const t = (await rf(`/api/mission-trees/${rootId}`)).json;
    const sig = JSON.stringify(t.counts) + t.pending;
    if (sig !== last) { last = sig; console.log(`── t+${Math.round((Date.now() - started) / 1000)}s realized=${t.realized} pending=${t.pending} ${JSON.stringify(t.counts)} ──`); render(t.tree); console.log(""); }
    const c = t.counts || {}; const open = (c.queued || 0) + (c.running || 0);
    if (t.pending === 0 && open === 0) break;
    await sleep(9000);
  }

  // ---- Inspect ACTUAL tool calls per node ----
  const t = (await rf(`/api/mission-trees/${rootId}`)).json;
  const nodes = flatten(t.tree).filter((n) => n.id);
  console.log(`\n================= WHAT ACTUALLY EXECUTED (per node) =================`);
  for (const n of nodes) {
    const m = (await rf(`/api/missions/${n.id}`)).json.mission;
    const steps = m?.steps || [];
    const actions = steps.filter((s) => s.kind === "action").map((s) => s.text);
    const results = steps.filter((s) => s.kind === "result").map((s) => (s.text || "").slice(0, 140));
    const errors = steps.filter((s) => s.kind === "error").map((s) => (s.text || "").slice(0, 140));
    console.log(`\n▸ [${m?.status}] ${n.objective.slice(0, 64)}`);
    console.log(`   tools invoked: ${actions.length ? actions.map((a) => `"${a}"`).join(", ") : "(none)"}`);
    if (errors.length) console.log(`   tool errors:   ${errors.join(" | ")}`);
    if (results.length) console.log(`   result:        ${results[0]}`);
  }

  // ---- Which notes were actually written ----
  const notes = (await rf("/api/data/notes")).json.items || [];
  const ours = notes.filter((n) => /^prism44 — /i.test(n.title || ""));
  console.log(`\n================= REAL ARTIFACTS WRITTEN =================`);
  console.log(`Notes created (${ours.length}):`);
  ours.forEach((n) => console.log(`   • "${n.title}" (${(n.body || "").length} chars)`));

  // ---- Timeline (activity feed) entries for these missions ----
  const feed = (await rf("/api/activity?brandId=" + prism.id + "&limit=60")).json.activity || [];
  const treeIds = new Set(nodes.map((n) => n.id));
  const tl = feed.filter((a) => treeIds.has(a.refId) || /prism44/i.test(a.title));
  console.log(`\nTimeline entries logged for this tree: ${tl.filter((a) => treeIds.has(a.refId)).length} (mission created/completed events)`);

  console.log(`\nTree API: ${BASE}/api/mission-trees/${rootId}\n`);
})().catch((e) => { console.error("run-grow-prism44 crashed:", e); process.exit(1); });
