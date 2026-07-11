#!/usr/bin/env node
/**
 * simulate-week — drives the REAL mission engine to (1) build initial mission
 * trees for every active objective and (2) run an accelerated week of autonomous
 * execution, then reports the four command-center sections with real data.
 *
 * No placeholder data: every mission is created + executed by the real engine
 * (the deployed worker runs them). "One week" is represented by N accelerated
 * autonomous cycles — wall-clock (deadlines/scheduling) can't be fast-forwarded.
 *
 * Usage: BASE=https://<host> CYCLES=7 node scripts/simulate-week.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
const CYCLES = Number(process.env.CYCLES) || 7;
const SETTLE_MS = Number(process.env.SETTLE_MS) || 25_000;

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
const ops = async () => (await rf("/api/ops")).json;
const short = (s, n = 70) => String(s || "").replace(/\s+/g, " ").slice(0, n);
const fmtDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "—");

(async () => {
  console.log(`\n=== Autonomous execution simulation · ${BASE} ===\n`);
  const brands = (await rf("/api/brands")).json.brands || [];
  const brandName = (id) => brands.find((b) => b.id === id)?.name || "—";

  // ---------- baseline ----------
  const base = await ops();
  const baseDone = base.counts?.done || 0;
  console.log(`Baseline: ${baseDone} missions already completed. Building initial mission trees…\n`);

  // ---------- Phase 1: initial mission trees ----------
  const objs = (await rf("/api/objectives")).json.objectives || [];
  const active = objs.filter((o) => o.status === "active");
  const trees = [];
  for (const o of active) {
    const r = await rf(`/api/objectives/${o.id}/plan`, { method: "POST", body: JSON.stringify({ force: true }) });
    const created = r.json?.plan?.created || [];
    trees.push({ objective: o.title, brand: brandName(o.brandId), created: created.map((c) => short(c.objective, 60)) });
  }
  console.log("INITIAL MISSION TREES");
  for (const t of trees) {
    console.log(`\n▸ ${t.objective}  [${t.brand}]`);
    if (t.created.length === 0) console.log("    (no new missions this pass — tree already populated / at capacity)");
    for (const c of t.created) console.log(`    • ${c}`);
  }

  // ---------- Phase 2: seed genuinely gated + dependency-blocked work ----------
  // (a) real approval-gated missions: booking a calendar event requires approval.
  for (const o of active.slice(0, 2)) {
    await rf("/api/missions", { method: "POST", body: JSON.stringify({
      objective: `Book a 30-minute discovery call for ${o.title}: create a calendar event titled "${brandName(o.brandId)} Discovery Call" next Tuesday at 10:00am.`,
      brandId: o.brandId, objectiveId: o.id,
    }) });
  }
  // (b) real dependency chain: a lead's playbook missions are chained (each depends on the previous).
  const prism = brands.find((b) => b.name === "Prism44");
  if (prism) {
    const form = ((await rf(`/api/onboarding?brandId=${prism.id}`)).json.forms || []).find((f) => (f.fields || []).some((x) => x.mapsTo === "name"));
    if (form) {
      const nameF = form.fields.find((f) => f.mapsTo === "name"); const emailF = form.fields.find((f) => f.mapsTo === "email");
      await rf(`/api/onboarding/${form.id}/submit`, { method: "POST", body: JSON.stringify({ data: { [nameF.id]: "Simulated Week Lead", [emailF.id]: "week@sim.co" }, leadSource: "instagram", campaign: "sim-week" }) });
    }
  }

  // ---------- Phase 3: accelerated autonomous cycles ("days") ----------
  let maxInProgress = 0;
  for (let c = 1; c <= CYCLES; c++) {
    await sleep(3000); // let the worker pick up freshly-queued work…
    const mid = await ops();                     // …snapshot to catch missions IN PROGRESS
    const ip = mid.sections?.inProgress?.length || 0;
    maxInProgress = Math.max(maxInProgress, ip);
    const s = mid.sections || {};
    console.log(`\nDay ${c}: inProgress=${ip} blocked=${s.blocked?.length || 0} awaitingApproval=${s.waitingApproval?.length || 0} completedWhileAway=${s.completedWhileAway?.length || 0} (done total=${mid.counts?.done || 0})`);
    // re-plan every objective (continuous reprioritization) → fresh work as prior completes
    for (const o of active) await rf(`/api/objectives/${o.id}/plan`, { method: "POST", body: JSON.stringify({ force: true }) }).catch(() => {});
    await sleep(SETTLE_MS); // let the worker execute this cycle's work
  }

  // ---------- Phase 4: final report ----------
  const fin = await ops();
  const s = fin.sections || {};
  const line = (m) => `    • [${brandName(m.brandId)}] ${short(m.objective)} — P${m.priority ?? 0}, ${m.progress ?? 0}%${m.deadline ? `, due ${fmtDate(m.deadline)}` : ""}${(m.dependencies || []).length ? `, blocked by ${m.dependencies.length} dep(s)` : ""}`;
  const section = (title, arr) => {
    console.log(`\n${title}: ${arr?.length || 0}`);
    (arr || []).slice(0, 8).forEach((m) => console.log(line(m)));
  };

  console.log(`\n\n================= WEEK RESULT (real engine) =================`);
  console.log(`Missions completed during the run: ${(fin.counts?.done || 0) - baseDone} (total done: ${fin.counts?.done || 0})`);
  console.log(`Peak concurrent missions IN PROGRESS observed: ${maxInProgress}`);
  section("IN PROGRESS (point-in-time)", s.inProgress);
  section("COMPLETED WHILE AWAY (done, unseen)", s.completedWhileAway);
  section("BLOCKED (failed / paused / waiting on dependencies)", s.blocked);
  section("AWAITING APPROVAL", s.waitingApproval);

  // per-objective rollup
  console.log(`\nPER-OBJECTIVE MISSION TREES (final)`);
  const finalObjs = (await rf("/api/objectives")).json.objectives || [];
  for (const o of finalObjs.filter((x) => x.status === "active")) {
    const m = o.missions || {};
    console.log(`  ▸ ${o.title} [${brandName(o.brandId)}] progress=${o.progress}%  total=${m.total} inProgress=${m.inProgress} queued=${m.queued} blocked=${m.blocked} approval=${m.waitingApproval} done=${m.done}`);
  }
  console.log(`\n============================================================\n`);
})().catch((e) => { console.error("simulate-week crashed:", e); process.exit(1); });
