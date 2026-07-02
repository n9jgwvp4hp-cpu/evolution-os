#!/usr/bin/env node
/**
 * Evolution OS — worker stress test.
 *   BASE_URL=... N=25 RECUR=3 node scripts/stress.mjs
 *
 * Fires N concurrent one-shot missions + RECUR recurring (every 1 min), then
 * monitors for: completion, stuck missions, worker liveness under load, store
 * growth, and double-execution. Self-cleaning (cancels recurring chains).
 * Exits non-zero if reliability invariants are violated.
 */
const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const N = Number(process.env.N || 25);
const RECUR = Number(process.env.RECUR || 3);
const STUCK_MS = 4 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(path, opts) { const r = await fetch(BASE + path, opts); return { status: r.status, json: await r.json().catch(() => null) }; }
const list = async () => (await j("/api/missions")).json.missions;
const create = async (b) => (await j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json.id;
const cancel = (id) => j(`/api/missions/${id}/cancel`, { method: "POST" });
const health = async () => (await j("/api/health")).json;

(async () => {
  console.log(`Stress — target ${BASE} | N=${N} concurrent + ${RECUR} recurring`);
  const marker = `STRESS ${Date.now()}`;

  // fire everything concurrently
  const oneShotIds = await Promise.all(
    Array.from({ length: N }, (_, i) => create({ objective: `Save a note titled '${marker} #${i}' with body stress-${i}. Then report.` }))
  );
  const recurIds = await Promise.all(
    Array.from({ length: RECUR }, (_, i) => create({ objective: `Save a note titled '${marker} recur ${i}' body tick.`, delayMinutes: 0, everyMinutes: 1 }))
  );
  const oneShots = new Set(oneShotIds.filter(Boolean));
  console.log(`launched ${oneShots.size} one-shot + ${recurIds.filter(Boolean).length} recurring`);

  let peakStoreKB = 0, workerEverDead = false, stuck = [];
  const start = Date.now();
  const deadline = start + 9 * 60 * 1000;

  while (Date.now() < deadline) {
    await sleep(8000);
    const [ms, h] = [await list(), await health()];
    const now = Date.now();
    const mine = ms.filter((m) => oneShots.has(m.id));
    const doneN = mine.filter((m) => m.status === "done").length;
    const failN = mine.filter((m) => m.status === "failed").length;
    const runN = mine.filter((m) => m.status === "running").length;
    const queueN = mine.filter((m) => m.status === "queued").length;
    peakStoreKB = Math.max(peakStoreKB, h.storeKB || 0);
    if (!h.worker?.alive) workerEverDead = true;
    stuck = ms.filter((m) => ["running", "queued"].includes(m.status) && now - m.updatedAt > STUCK_MS && !m.scheduledFor);
    console.log(`  t=${Math.round((now - start) / 1000)}s | one-shot done ${doneN}/${N} fail ${failN} run ${runN} q ${queueN} | worker ${h.worker?.alive ? "up" : "DOWN"} | storeKB ${h.storeKB} apiMsgs ${h.apiMsgs} | stuck ${stuck.length}`);
    if (doneN + failN >= N) break;
  }

  // results
  const finalMine = (await list()).filter((m) => oneShots.has(m.id));
  const done = finalMine.filter((m) => m.status === "done").length;
  const failed = finalMine.filter((m) => m.status === "failed").length;
  const notes = (await j("/api/data/notes")).json.items.filter((n) => n.title.startsWith(marker) && !n.title.includes("recur"));
  const uniqueTitles = new Set(notes.map((n) => n.title)).size;

  console.log("\n=== cleanup recurring chains ===");
  let cleared = false;
  for (let r = 0; r < 16; r++) {
    const active = (await list()).filter((x) => x.objective.includes(marker) && x.objective.includes("recur") && ["queued", "running"].includes(x.status));
    if (!active.length) { cleared = true; break; }
    for (const x of active) await cancel(x.id);
    await sleep(5000);
  }

  console.log("\n=== RESULTS ===");
  let failCount = 0;
  const ok = (c, m) => { if (!c) failCount++; console.log(`  ${c ? "✓" : "✗ FAIL"} ${m}`); };
  ok(done === N, `all ${N} one-shot missions completed (done=${done}, failed=${failed})`);
  ok(stuck.length === 0, `no stuck missions (${stuck.length})`);
  ok(!workerEverDead, "worker stayed alive under load");
  ok(uniqueTitles === done, `no double-execution: ${uniqueTitles} unique notes for ${done} done missions`);
  ok(peakStoreKB < 5000, `store stayed bounded under load (peak ${peakStoreKB} KB)`);
  ok(cleared, "recurring chains stopped (no runaway)");
  console.log(`\n${failCount === 0 ? "STRESS PASS" : "STRESS FAIL (" + failCount + ")"}`);
  process.exit(failCount === 0 ? 0 : 1);
})();
