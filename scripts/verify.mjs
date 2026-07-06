#!/usr/bin/env node
/**
 * Evolution OS — authoritative PRODUCTION verification suite.
 *
 *   node scripts/verify.mjs            # against production
 *   BASE_URL=http://localhost:3000 node scripts/verify.mjs
 *
 * One command, clear PASS/FAIL, exit code 0/1. Exercises the autonomous-OS
 * guarantees end to end against the LIVE system:
 *
 *   1. Persistent execution   — missions/steps live in PostgreSQL.
 *   2. Immediate persistence  — every state transition is visible mid-flight.
 *   3. Background reliability  — the worker executes without the client.
 *   4. Recovery after app close — a mission runs to completion while nobody watches.
 *   5. Exactly-once @ scale     — 20 concurrent missions, each side effect once.
 *
 * Dependency-free (Node fetch), with retry so a transient blip can't crash it.
 */
const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const RUN = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PASS = 0, FAIL = 0;
const ok = (cond, msg) => { cond ? PASS++ : FAIL++; console.log(`   ${cond ? "✓ PASS" : "✗ FAIL"}  ${msg}`); return cond; };
const head = (n, t) => console.log(`\n[${n}] ${t}`);

async function rfetch(url, opts, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); } catch (e) { if (i === tries - 1) throw e; await sleep(1200 * (i + 1)); }
  }
}
async function j(path, opts) { const r = await rfetch(BASE + path, opts); return r.json().catch(() => null); }
const health = () => j("/api/health");
const missions = async () => (await j("/api/missions")).missions;
const getM = async (id) => (await missions()).find((m) => m.id === id);
const tasks = async () => (await j("/api/data/tasks")).items;
const create = async (objective, extra = {}) => (await j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective, ...extra }) })).id;

async function waitTerminal(id, timeoutMs = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const m = await getM(id);
    if (m && (m.status === "done" || m.status === "failed")) return m;
    await sleep(3000);
  }
  return await getM(id);
}

// ---------------------------------------------------------------------------
(async () => {
  console.log(`EVOLUTION OS — PRODUCTION VERIFICATION | ${BASE} | run ${RUN}`);

  // 1. Persistent execution + backend
  head(1, "Persistent execution & backend");
  const h = await health();
  ok(h?.ok === true, "health endpoint responds ok");
  ok(h?.store === "postgres", `store backend is PostgreSQL (got ${h?.store})`);
  ok(h?.worker?.alive === true, `background worker is alive (last beat ${Math.round((h?.worker?.lastBeatMsAgo || 0) / 1000)}s ago)`);
  ok(typeof h?.storeKB === "number", `store instrumented (storeKB=${h?.storeKB}, apiMsgs=${h?.apiMsgs})`);

  // 2. Immediate state persistence — transitions observable mid-flight
  head(2, "Immediate state persistence (every transition persists)");
  const id2 = await create(`Add a task titled "V-${RUN}-probe" with priority high. Then report the title and priority.`);
  const seen = new Set();
  let sawQueuedOrRunning = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 150000) {
    const m = await getM(id2);
    if (m) { seen.add(m.status); if (m.status === "queued" || m.status === "running") sawQueuedOrRunning = true; if (m.status === "done" || m.status === "failed") break; }
    await sleep(2000);
  }
  const m2 = await getM(id2);
  ok(sawQueuedOrRunning, `intermediate state persisted + observable before completion (saw: ${[...seen].join(",")})`);
  ok(m2?.status === "done", `mission reached done (status=${m2?.status})`);
  ok((m2?.steps?.length || 0) >= 3, `full step lifecycle persisted (${m2?.steps?.length} steps)`);
  const probeTask = (await tasks()).filter((t) => t.title === `V-${RUN}-probe`);
  ok(probeTask.length === 1 && probeTask[0].priority === "high", `real side effect persisted exactly once (found ${probeTask.length}, priority ${probeTask[0]?.priority})`);

  // 3+4. Background reliability & recovery after app close — walk away, come back
  head(3, "Background reliability & recovery after app close");
  const id3 = await create(`Add a task titled "V-${RUN}-away" with priority medium. Then report.`);
  console.log(`   … created ${id3}; simulating app close (no polling for 45s) …`);
  await sleep(45000); // client is "gone" — server must finish it alone
  const m3 = await getM(id3);
  ok(m3?.status === "done", `mission completed with NO client involvement (status=${m3?.status})`);
  ok(m3?.acknowledged !== true, `result is waiting to be seen on return (acknowledged=${m3?.acknowledged})`);
  ok((await tasks()).some((t) => t.title === `V-${RUN}-away`), "its side effect is present after 'reopening'");

  // 5. Exactly-once at scale — 20 concurrent missions
  head(5, "Exactly-once execution @ scale — 20 concurrent missions");
  const N = 20;
  const ids = (await Promise.all(
    Array.from({ length: N }, (_, i) => create(`Add exactly ONE task titled "V-${RUN}-c${String(i).padStart(2, "0")}" with priority high. Do nothing else. Then report.`))
  )).filter(Boolean);
  console.log(`   … launched ${ids.length} concurrent missions; waiting for all to finish …`);
  let peakRunning = 0, everStuck = 0;
  const t5 = Date.now();
  while (Date.now() - t5 < 8 * 60 * 1000) {
    await sleep(6000);
    const all = await missions();
    const mine = all.filter((m) => ids.includes(m.id));
    const done = mine.filter((m) => m.status === "done").length;
    const failed = mine.filter((m) => m.status === "failed").length;
    const running = mine.filter((m) => m.status === "running").length;
    peakRunning = Math.max(peakRunning, running);
    const now = Date.now();
    everStuck = Math.max(everStuck, mine.filter((m) => ["queued", "running"].includes(m.status) && now - m.updatedAt > 4 * 60 * 1000 && !m.scheduledFor).length);
    console.log(`      done ${done}/${N} | failed ${failed} | running ${running}`);
    if (done + failed >= N) break;
  }
  const finalMine = (await missions()).filter((m) => ids.includes(m.id));
  const done = finalMine.filter((m) => m.status === "done").length;
  const cTasks = (await tasks()).filter((t) => /^V-\d+-c\d\d$/.test(t.title) && t.title.startsWith(`V-${RUN}-c`));
  const counts = {};
  for (const t of cTasks) counts[t.title] = (counts[t.title] || 0) + 1;
  const dups = Object.entries(counts).filter(([, n]) => n > 1);
  ok(ids.length === N, `created all ${N} missions`);
  ok(done === N, `ALL ${N} missions completed (done=${done})`);
  ok(everStuck === 0, `no stuck missions (${everStuck})`);
  ok(cTasks.length === N, `exactly ${N} tasks created (got ${cTasks.length})`);
  ok(dups.length === 0, `EXACTLY ONCE — zero duplicate side effects (${Object.keys(counts).length} unique titles)`);
  console.log(`      (peak concurrent running observed: ${peakRunning})`);

  // ---- verdict ----
  console.log(`\n${"=".repeat(60)}`);
  console.log(`RESULT: ${PASS} passed, ${FAIL} failed`);
  console.log(FAIL === 0 ? "✅ VERIFICATION PASSED — autonomous execution is persistent, reliable, recoverable, and exactly-once." : "❌ VERIFICATION FAILED");
  process.exit(FAIL === 0 ? 0 : 1);
})().catch((e) => { console.error("verification crashed:", e?.message || e); process.exit(1); });
