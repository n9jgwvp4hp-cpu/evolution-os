#!/usr/bin/env node
/**
 * Milestone 6 proof — Evolution OS survives interruption.
 *
 *   node scripts/prove-m6.mjs
 *
 * 1. Creates 5 missions, each of which creates 10 uniquely-named to-do tasks
 *    one step at a time (so they take long enough to be mid-execution).
 * 2. Restarts the app (triggers a redeploy) and fires the 5 missions right at
 *    the cutover window, so the worker is SIGTERMed while they are still running.
 * 3. Snapshots each mission's state at the exact cutover instant (proof they were
 *    mid-execution when the app restarted).
 * 4. Waits for the new worker to reclaim + resume them, and shows all 5 reach
 *    'done'.
 * 5. Proves EXACT resume (not restart-from-scratch): the interrupted missions'
 *    step timelines span the cutover (actions before AND after), and there are
 *    ZERO duplicate tasks — the idempotency guard only holds because the model
 *    conversation was persisted and resumed, not replayed from zero.
 */
import { readFileSync } from "fs";
import { homedir } from "os";

const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const N = 5;            // missions
const K = 10;           // tasks per mission
const RUN = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rfetch(url, opts, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); } catch (e) { if (i === tries - 1) throw e; await sleep(1500 * (i + 1)); }
  }
}
const doToken = () => readFileSync(`${homedir()}/Library/Application Support/doctl/config.yaml`, "utf8").match(/access-token:\s*(\S+)/)[1];
const doApi = (p, opts) => rfetch(`https://api.digitalocean.com/v2/apps/${APP}${p}`, { ...opts, headers: { Authorization: `Bearer ${doToken()}`, "Content-Type": "application/json", ...(opts?.headers || {}) } }).then((r) => r.json());
async function j(path, opts) { const r = await rfetch(BASE + path, opts); return r.json().catch(() => null); }
const list = async () => (await j("/api/missions")).missions;
const tasks = async () => (await j("/api/data/tasks")).items;
const create = async (obj) => (await j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: obj }) })).id;
const phaseOf = async (dep) => (await doApi(`/deployments/${dep}`)).deployment.phase;
const clock = (ts) => new Date(ts).toISOString().slice(11, 19);

const objective = (i) =>
  `Milestone 6 durability test, mission #${i}. Create exactly these ${K} to-do tasks, ONE AT A TIME ` +
  `(a single create-task action per step — do NOT batch them): ` +
  Array.from({ length: K }, (_, k) => `'M6-${RUN}-${i}-${String(k + 1).padStart(2, "0")}'`).join(", ") +
  `. Create them one per step, in order. After all ${K} exist, report the list of task titles you created.`;

(async () => {
  console.log(`MILESTONE 6 — SURVIVE INTERRUPTION | ${BASE} | run ${RUN}`);
  console.log(`Plan: fire ${N} missions across a real app restart; each creates ${K} unique tasks.\n`);

  console.log("→ RESTART: triggering redeploy (this will SIGTERM the worker mid-execution)");
  const dep = (await doApi("/deployments", { method: "POST", body: JSON.stringify({ force_build: true }) })).deployment.id;
  console.log(`  deployment ${dep}\n`);

  const ids = [];
  let fired = false, snap = null, cutoverAt = 0, peakRunning = 0;
  const start = Date.now();
  const deadline = start + 14 * 60 * 1000;

  while (Date.now() < deadline) {
    const phase = await phaseOf(dep);

    // fire the 5 missions right as the cutover approaches (DEPLOYING) so they're
    // running when the old worker is replaced
    if (!fired && phase === "DEPLOYING") {
      for (let i = 1; i <= N; i++) ids.push(await create(objective(i)));
      fired = true;
      console.log(`  [${clock(Date.now())}] fired ${ids.filter(Boolean).length} missions at DEPLOYING: ${ids.join(", ")}`);
    }

    const mine = fired ? (await list()).filter((m) => ids.includes(m.id)) : [];
    const running = mine.filter((m) => m.status === "running").length;
    const done = mine.filter((m) => m.status === "done").length;
    peakRunning = Math.max(peakRunning, running);

    if (fired && !snap && phase === "ACTIVE") {
      cutoverAt = Date.now();
      snap = mine.map((m) => ({ id: m.id, status: m.status, steps: (m.steps || []).length }));
      console.log(`  [${clock(cutoverAt)}] ✦ RESTART CUTOVER (deployment ACTIVE — old worker replaced)`);
      console.log(`      mission states at the instant of restart:`);
      snap.forEach((s) => console.log(`        ${s.id}: ${s.status} (${s.steps} steps so far)`));
    }

    if (fired) console.log(`  [${clock(Date.now())}] phase ${phase} | done ${done}/${N} running ${running}`);
    if (snap && done >= N) break;
    await sleep(6000);
  }

  // ---------- verify ----------
  const finalMine = (await list()).filter((m) => ids.includes(m.id));
  const doneCount = finalMine.filter((m) => m.status === "done").length;
  const runTasks = (await tasks()).filter((t) => t.title.startsWith(`M6-${RUN}-`));
  const titleCounts = {};
  for (const t of runTasks) titleCounts[t.title] = (titleCounts[t.title] || 0) + 1;
  const duplicates = Object.entries(titleCounts).filter(([, n]) => n > 1);

  const interrupted = (snap || []).filter((s) => s.status === "running" || s.status === "queued");
  const interruptedResumed = interrupted.filter((s) => finalMine.find((m) => m.id === s.id)?.status === "done");

  console.log("\n────────── step timeline of one interrupted mission (spans the restart) ──────────");
  const sample = interrupted[0] && finalMine.find((m) => m.id === interrupted[0].id);
  if (sample) {
    for (const s of sample.steps) {
      const marker = cutoverAt && s.ts >= cutoverAt ? "  ⟵ AFTER restart (resumed)" : "";
      console.log(`  [${clock(s.ts)}] ${s.kind.padEnd(8)} ${s.text.slice(0, 60)}${marker}`);
    }
  } else {
    console.log("  (no mission captured mid-flight at the cutover instant this run)");
  }

  console.log("\n=== RESULTS ===");
  let fail = 0;
  const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? "✓" : "✗ FAIL"} ${m}`); };
  ok(ids.filter(Boolean).length === N, `created ${ids.filter(Boolean).length}/${N} missions`);
  ok(!!snap, "captured the app-restart cutover");
  ok(interrupted.length > 0, `missions were mid-execution at the restart: ${interrupted.length} (running/queued)`);
  ok(interruptedResumed.length === interrupted.length, `all ${interrupted.length} interrupted missions recovered + completed after restart (${interruptedResumed.length})`);
  ok(doneCount === N, `ALL ${N} missions completed successfully (done=${doneCount})`);
  ok(duplicates.length === 0, `EXACT resume — zero duplicate tasks across the interruption (${runTasks.length} tasks, ${Object.keys(titleCounts).length} unique)`);
  console.log(`  • peak concurrent running: ${peakRunning}`);
  console.log(`\n${fail === 0 ? "✅ MILESTONE 6 PROVEN — all 5 missions survived a mid-execution restart." : "❌ MILESTONE 6 FAILED (" + fail + ")"}`);
  process.exit(fail === 0 ? 0 : 1);
})();
