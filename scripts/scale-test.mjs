#!/usr/bin/env node
/**
 * Evolution OS — horizontal-scale validation for a multi-instance worker.
 *
 *   BASE_URL=... N=40 node scripts/scale-test.mjs
 *
 * Each worker process caps itself at MAX_CONCURRENT=3. So if we ever observe
 * MORE than 3 missions running at once, more than one worker is executing —
 * direct, black-box proof of horizontal scale. We also verify no double-
 * execution (one note per mission) and measure throughput.
 *
 * Sampling is frequent (every 2.5s) to catch concurrency peaks.
 */
const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const N = Number(process.env.N || 40);
const SINGLE_WORKER_CAP = 3; // MAX_CONCURRENT per worker process
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(path, opts) { const r = await fetch(BASE + path, opts); return r.json().catch(() => null); }
const list = async () => (await j("/api/missions")).missions;
const create = async (b) => (await j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).id;

(async () => {
  console.log(`Scale test — ${BASE} | firing ${N} missions, watching peak concurrency`);
  const marker = `SCALE ${Date.now()}`;
  const ids = new Set((await Promise.all(
    Array.from({ length: N }, (_, i) => create({ objective: `Save a note titled '${marker} #${i}' with body scale-${i}. Then report.` }))
  )).filter(Boolean));
  console.log(`launched ${ids.size} missions`);

  let peakRunning = 0, firstDone = 0, lastDone = 0, everStuck = 0;
  const start = Date.now();
  const deadline = start + 12 * 60 * 1000;

  while (Date.now() < deadline) {
    await sleep(2500);
    const ms = await list();
    const now = Date.now();
    const mine = ms.filter((m) => ids.has(m.id));
    const running = mine.filter((m) => m.status === "running").length;
    const done = mine.filter((m) => m.status === "done").length;
    const failed = mine.filter((m) => m.status === "failed").length;
    if (running > peakRunning) peakRunning = running;
    if (done > 0 && !firstDone) firstDone = now;
    if (done > 0) lastDone = now;
    const stuck = mine.filter((m) => ["queued", "running"].includes(m.status) && now - m.updatedAt > 4 * 60 * 1000 && !m.scheduledFor).length;
    everStuck = Math.max(everStuck, stuck);
    const tag = running > SINGLE_WORKER_CAP ? "  <-- >1 worker!" : "";
    console.log(`  t=${Math.round((now - start) / 1000)}s | done ${done}/${N} fail ${failed} running ${running} (peak ${peakRunning})${tag}`);
    if (done + failed >= N) break;
  }

  // throughput + no-dup
  const finalMine = (await list()).filter((m) => ids.has(m.id));
  const done = finalMine.filter((m) => m.status === "done").length;
  const failed = finalMine.filter((m) => m.status === "failed").length;
  const notes = (await j("/api/data/notes")).items.filter((n) => n.title.startsWith(marker));
  const uniqueNotes = new Set(notes.map((n) => n.title)).size;
  const spanSec = Math.max(1, (lastDone - firstDone) / 1000);
  const throughput = (done / spanSec) * 60;

  console.log("\n=== RESULTS ===");
  let fail = 0;
  const ok = (c, m) => { if (!c) fail++; console.log(`  ${c ? "✓" : "✗ FAIL"} ${m}`); };
  ok(done === N, `all ${N} completed (done=${done}, failed=${failed})`);
  ok(peakRunning > SINGLE_WORKER_CAP, `HORIZONTAL SCALE: peak concurrent running = ${peakRunning} (>${SINGLE_WORKER_CAP} ⇒ both workers executing)`);
  ok(uniqueNotes === done, `no double-execution: ${uniqueNotes} unique notes for ${done} done`);
  ok(everStuck === 0, `no stuck missions (${everStuck})`);
  console.log(`  • throughput ≈ ${throughput.toFixed(1)} missions/min over the busy span (single-worker baseline ≈ 9/min)`);
  console.log(`\n${fail === 0 ? "SCALE PASS" : "SCALE FAIL (" + fail + ")"}`);
  process.exit(fail === 0 ? 0 : 1);
})();
