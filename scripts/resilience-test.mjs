#!/usr/bin/env node
/**
 * Evolution OS — worker lease-recovery + rolling-deploy safety (reliable vehicle).
 *
 *   node scripts/resilience-test.mjs
 *
 * Ground truth: the DO deployment reaching ACTIVE means the old worker container
 * is replaced. We fire a steady stream of SHORT, RELIABLE missions (save a note —
 * no flaky external calls) across the build→cutover window so some are mid-flight
 * when the old worker is drained/replaced. Those must be reclaimed by the new
 * worker and finish, with no duplicates.
 *
 * Reports: peak concurrent running (rolling overlap can exceed one worker's cap
 * of 3), missions running at cutover that then completed (reclaim), and the
 * duplicate check across the whole cutover.
 */
import { readFileSync } from "fs";
import { homedir } from "os";

const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const doToken = () => readFileSync(`${homedir()}/Library/Application Support/doctl/config.yaml`, "utf8").match(/access-token:\s*(\S+)/)[1];
const doApi = (p, opts) => fetch(`https://api.digitalocean.com/v2/apps/${APP}${p}`, {
  ...opts, headers: { Authorization: `Bearer ${doToken()}`, "Content-Type": "application/json", ...(opts?.headers || {}) },
}).then((r) => r.json());
async function j(path, opts) { const r = await fetch(BASE + path, opts); return r.json().catch(() => null); }
const list = async () => (await j("/api/missions")).missions;
const create = async (b) => (await j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).id;
const phaseOf = async (dep) => (await doApi(`/deployments/${dep}`)).deployment.phase;

const marker = `RESIL ${Date.now()}`;
const ids = new Set();
let fired = 0;
async function fireOne() {
  const id = await create({ objective: `Save a note titled '${marker} #${fired++}' with body ok. Then report.` });
  if (id) ids.add(id);
}

(async () => {
  console.log(`Resilience test — ${BASE} | reliable missions across a real worker cutover`);
  const dep = (await doApi("/deployments", { method: "POST", body: JSON.stringify({ force_build: true }) })).deployment.id;
  console.log(`→ deployment ${dep} triggered; streaming missions across the build/cutover window`);

  let snapAtCutover = null, firstActiveAt = 0, peakRunning = 0;
  const start = Date.now();
  const deadline = start + 14 * 60 * 1000;

  while (Date.now() < deadline) {
    const phase = await phaseOf(dep);
    const now = Date.now();
    // Stream missions from mid-build through ~40s past cutover so some are always
    // mid-flight when the old worker is replaced.
    const inFiringWindow = phase === "BUILDING" || phase === "DEPLOYING" || (firstActiveAt && now - firstActiveAt < 40000);
    if (inFiringWindow) await fireOne();

    const mine = (await list()).filter((m) => ids.has(m.id));
    const running = mine.filter((m) => m.status === "running").length;
    const done = mine.filter((m) => m.status === "done").length;
    if (running > peakRunning) peakRunning = running;
    if (!firstActiveAt && phase === "ACTIVE") {
      firstActiveAt = now;
      snapAtCutover = mine.map((m) => ({ id: m.id, status: m.status }));
      console.log(`  ✦ cutover: ACTIVE — old worker replaced (${mine.filter((m) => m.status === "running").length} running now)`);
    }
    console.log(`  t=${Math.round((now - start) / 1000)}s | phase ${phase} | fired ${ids.size} done ${done} running ${running} (peak ${peakRunning})`);
    if (firstActiveAt && now - firstActiveAt > 40000 && done >= ids.size) break;
    await sleep(4000);
  }

  const finalMine = (await list()).filter((m) => ids.has(m.id));
  const done = finalMine.filter((m) => m.status === "done").length;
  const failed = finalMine.filter((m) => m.status === "failed").length;
  const runningAtCutover = (snapAtCutover || []).filter((s) => s.status === "running").map((s) => s.id);
  const reclaimed = runningAtCutover.filter((id) => finalMine.find((m) => m.id === id)?.status === "done").length;
  const notes = (await j("/api/data/notes")).items.filter((n) => n.title.startsWith(marker));
  const uniqueNotes = new Set(notes.map((n) => n.title)).size;

  console.log("\n=== RESULTS ===");
  let fail = 0;
  const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? "✓" : "✗ FAIL"} ${m}`); };
  ok(!!snapAtCutover, "observed the deployment cutover (old worker replaced)");
  ok(peakRunning > 3, `rolling-deploy overlap: peak concurrent running = ${peakRunning} (>3 ⇒ old+new workers overlapped, atomic claim held)`);
  ok(runningAtCutover.length > 0, `missions were mid-flight at cutover: ${runningAtCutover.length}`);
  ok(reclaimed === runningAtCutover.length, `LEASE RECOVERY: all ${runningAtCutover.length} running-at-cutover missions reclaimed + finished by the new worker (${reclaimed})`);
  ok(done === ids.size, `all ${ids.size} reliable missions completed (done=${done}, failed=${failed})`);
  ok(uniqueNotes === done, `no double-execution across the cutover: ${uniqueNotes} unique notes for ${done} done`);
  console.log(`\n${fail === 0 ? "RESILIENCE PASS" : "RESILIENCE FAIL (" + fail + ")"}`);
  process.exit(fail === 0 ? 0 : 1);
})();
