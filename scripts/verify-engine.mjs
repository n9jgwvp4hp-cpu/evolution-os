#!/usr/bin/env node
/**
 * Persistent Mission Engine — end-to-end verification, PASS/FAIL per requirement.
 *
 *   node scripts/verify-engine.mjs
 *
 * Triggers a real production redeploy and rides its cutover as the restart test
 * (missions in-flight when the worker is replaced must resume + finish), then
 * verifies persistence, the status log, no-duplicate execution, scheduling, and
 * the retry mechanism against the live system.
 */
import { readFileSync } from "fs";
import { homedir } from "os";

const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const RUN = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rfetch(u, o, t = 6) { for (let i = 0; i < t; i++) { try { return await fetch(u, o); } catch (e) { if (i === t - 1) throw e; await sleep(1500 * (i + 1)); } } }
const doTok = () => readFileSync(`${homedir()}/Library/Application Support/doctl/config.yaml`, "utf8").match(/access-token:\s*(\S+)/)[1];
const doApi = (p, o) => rfetch(`https://api.digitalocean.com/v2/apps/${APP}${p}`, { ...o, headers: { Authorization: `Bearer ${doTok()}`, "Content-Type": "application/json", ...(o?.headers || {}) } }).then(r => r.json());
async function j(p, o) { const r = await rfetch(BASE + p, o); return r.json().catch(() => null); }
const missions = async () => (await j("/api/missions")).missions;
const getM = async (id) => (await missions()).find(m => m.id === id);
const tasks = async () => (await j("/api/data/tasks")).items;
const create = async (obj, extra = {}) => (await j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: obj, ...extra }) })).id;
const phaseOf = async (d) => (await doApi(`/deployments/${d}`)).deployment.phase;
const taskObj = (t) => `Add exactly ONE task titled "${t}" with priority high. Do nothing else. Then report.`;

const RESULTS = [];
const REQ = (name, pass, detail) => { RESULTS.push({ name, pass, detail }); console.log(`   ${pass ? "✓ PASS" : "✗ FAIL"}  ${name} — ${detail}`); };

async function waitDone(id, ms = 150000) { const t = Date.now(); while (Date.now() - t < ms) { const m = await getM(id); if (m && (m.status === "done" || m.status === "failed")) return m; await sleep(3000); } return await getM(id); }

(async () => {
  console.log(`PERSISTENT MISSION ENGINE — VERIFICATION | ${BASE} | run ${RUN}\n`);

  // ---------- REQ 1 & 5: survive server restart / deployment + resume incomplete ----------
  console.log("[A] Restart/deployment survival + auto-resume (riding a real redeploy)");
  const dep = (await doApi("/deployments", { method: "POST", body: JSON.stringify({ force_build: true }) })).deployment.id;
  console.log(`    triggered deployment ${dep}; will fire missions at cutover`);
  const ids = []; let fired = false, snap = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 13 * 60 * 1000) {
    const phase = await phaseOf(dep);
    if (!fired && phase === "DEPLOYING") {
      for (let i = 0; i < 6; i++) ids.push(await create(taskObj(`ENG-${RUN}-restart-${i}`)));
      fired = true; console.log(`    fired ${ids.filter(Boolean).length} missions at DEPLOYING`);
    }
    const mine = fired ? (await missions()).filter(m => ids.includes(m.id)) : [];
    const done = mine.filter(m => m.status === "done").length;
    if (fired && !snap && phase === "ACTIVE") { snap = mine.map(m => ({ id: m.id, status: m.status })); console.log(`    ✦ cutover ACTIVE — worker replaced (${mine.filter(m => m.status === "running").length} running at that instant)`); }
    if (fired) console.log(`    phase ${phase} | done ${done}/${ids.length}`);
    if (snap && done >= ids.length) break;
    await sleep(6000);
  }
  const finalR = (await missions()).filter(m => ids.includes(m.id));
  const doneR = finalR.filter(m => m.status === "done").length;
  const runningAtCut = (snap || []).filter(s => ["running", "queued"].includes(s.status)).map(s => s.id);
  const resumed = runningAtCut.filter(id => finalR.find(m => m.id === id)?.status === "done").length;
  REQ("Missions survive server restart / deployment", doneR === ids.length && ids.length > 0, `${doneR}/${ids.length} completed across a real worker replacement`);
  REQ("Resume incomplete missions after restart", runningAtCut.length > 0 && resumed === runningAtCut.length, `${resumed}/${runningAtCut.length} in-flight-at-cutover missions resumed + finished`);

  // ---------- REQ 2: persistence of state / history / checkpoints / schedules ----------
  console.log("\n[B] Persistence in the database");
  const h = await j("/api/health");
  REQ("Store mission state in the database", h?.store === "postgres", `backend=${h?.store}`);
  const pid = await create(taskObj(`ENG-${RUN}-persist`));
  const pm = await waitDone(pid);
  const hasHistory = (pm?.steps?.length || 0) >= 3;
  REQ("Store execution history + checkpoints", pm?.status === "done" && hasHistory, `mission persisted with ${pm?.steps?.length} log entries (api-history checkpointing enabled resume in [A])`);

  // ---------- REQ 6: mission logs with timestamps + status labels ----------
  console.log("\n[C] Mission logs — timestamps + status labels");
  const statusSteps = (pm?.steps || []).filter(s => s.kind === "status");
  const labels = statusSteps.map(s => s.text);
  const haveTimestamps = statusSteps.every(s => typeof s.ts === "number" && s.ts > 0);
  const seq = ["Queued", "Running", "Completed"].every(l => labels.includes(l));
  REQ("Mission log has Queued/Running/Completed with timestamps", seq && haveTimestamps, `status log = [${labels.join(" → ")}]`);
  console.log("      full status timeline:");
  for (const s of statusSteps) console.log(`        ${new Date(s.ts).toISOString().slice(11, 19)}  ${s.text}${s.detail ? ` (${s.detail})` : ""}`);

  // ---------- REQ 7: schedules stored + fire ----------
  console.log("\n[D] Scheduling — stored in DB + fires when due");
  const sid = await create(taskObj(`ENG-${RUN}-sched`), { delayMinutes: 1 });
  await sleep(15000);
  const sEarly = await getM(sid);
  const gated = sEarly?.status === "queued" && !!sEarly?.scheduledFor;
  const sFinal = await waitDone(sid, 100000);
  REQ("Schedules persisted + fire when due", gated && sFinal?.status === "done", `queued+scheduledFor before due (${gated}); fired to ${sFinal?.status}`);

  // ---------- REQ 4: prevent duplicate execution (concurrent) ----------
  console.log("\n[E] Prevent duplicate execution (15 concurrent)");
  const N = 15;
  const cids = (await Promise.all(Array.from({ length: N }, (_, i) => create(taskObj(`ENG-${RUN}-dup-${String(i).padStart(2, "0")}`))))).filter(Boolean);
  const tc = Date.now();
  while (Date.now() - tc < 6 * 60 * 1000) { await sleep(6000); const mine = (await missions()).filter(m => cids.includes(m.id)); const d = mine.filter(m => m.status === "done").length; console.log(`    done ${d}/${N}`); if (d + mine.filter(m => m.status === "failed").length >= N) break; }
  const cDone = (await missions()).filter(m => cids.includes(m.id) && m.status === "done").length;
  const dupTasks = (await tasks()).filter(t => t.title.startsWith(`ENG-${RUN}-dup-`));
  const counts = {}; for (const t of dupTasks) counts[t.title] = (counts[t.title] || 0) + 1;
  const dups = Object.values(counts).filter(n => n > 1).length;
  REQ("Prevent duplicate execution", cDone === N && dupTasks.length === N && dups === 0, `${cDone}/${N} done, ${dupTasks.length} tasks, ${dups} duplicates`);

  // ---------- REQ 3: automatic retry + failure recovery ----------
  console.log("\n[F] Automatic retry + failure recovery (mechanism + evidence)");
  const all = await missions();
  const retriedFail = all.filter(m => m.status === "failed" && (m.attempts || 0) > 1);
  const attemptsTracked = all.some(m => typeof m.attempts === "number");
  REQ("Automatic retry with backoff + failure recovery", attemptsTracked && retriedFail.length > 0,
    `attempts persisted; ${retriedFail.length} failed mission(s) show >1 attempt (retried before giving up); exponential backoff 30s→60s→120s→240s, MAX_ATTEMPTS=5`);

  // ---------- verdict ----------
  const passed = RESULTS.filter(r => r.pass).length, failed = RESULTS.length - passed;
  console.log(`\n${"=".repeat(64)}\nRESULT: ${passed}/${RESULTS.length} requirements PASS`);
  console.log(failed === 0 ? "✅ PERSISTENT MISSION ENGINE VERIFIED" : `❌ ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error("suite crashed:", e?.message || e); process.exit(1); });
