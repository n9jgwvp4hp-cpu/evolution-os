#!/usr/bin/env node
/**
 * Evolution OS — end-to-end reliability tests for mission execution.
 *
 * Dependency-free (Node 18+ fetch). Targets a running deployment:
 *   BASE_URL=https://your-app node scripts/e2e.mjs
 * Defaults to the production URL. Exits non-zero if any test fails.
 *
 * Covers: basic execution, idempotency (no duplicate side effects), scheduling
 * due-gating + firing, recurrence spawn + cancellation, and the health/store
 * invariants. It is self-cleaning (cancels any recurring chains it creates).
 */
const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";

let pass = 0, fail = 0;
const ok = (cond, msg) => { (cond ? pass++ : fail++); console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`); return cond; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const r = await fetch(BASE + path, opts);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: null, text: t }; }
}
const listMissions = async () => (await api("/api/missions")).json.missions;
const getMission = async (id) => (await listMissions()).find((m) => m.id === id);
const createMission = async (body) => (await api("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json.id;
const cancel = (id) => api(`/api/missions/${id}/cancel`, { method: "POST" });
const notes = async () => (await api("/api/data/notes")).json.items;

async function waitStatus(id, targets, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = await getMission(id);
    if (m && targets.includes(m.status)) return m;
    await sleep(3000);
  }
  return await getMission(id);
}

async function testHealth() {
  console.log("\n[health & store invariants]");
  const h = (await api("/api/health")).json;
  ok(h.ok === true, "health ok");
  ok(h.store === "postgres", `store is postgres (got ${h.store})`);
  ok(h.worker?.alive === true, "worker alive");
  ok(typeof h.storeKB === "number", `store instrumented (storeKB=${h.storeKB})`);
  ok(h.apiMsgs < 50, `retained api messages low (apiMsgs=${h.apiMsgs})`);
}

async function testExecutionAndIdempotency() {
  console.log("\n[execution + idempotency]");
  const title = `E2E Exec ${Date.now()}`;
  const id = await createMission({ objective: `Save a note titled "${title}" with body ok. Then report what you did.` });
  const m = await waitStatus(id, ["done", "failed"]);
  ok(m?.status === "done", `mission completed (status=${m?.status})`);
  ok(!!m?.result, "mission has a report");
  const matching = (await notes()).filter((n) => n.title === title);
  ok(matching.length === 1, `exactly one note created — no duplicates (found ${matching.length})`);
  const done = await getMission(id);
  ok((done.api?.length ?? 0) === 0 || done.api === undefined, "api history trimmed after completion");
}

async function testCancel() {
  console.log("\n[cancellation]");
  const id = await createMission({ objective: "Save a note titled 'E2E Cancel' body x.", delayMinutes: 5 });
  await sleep(1500);
  await cancel(id);
  await sleep(2500);
  const m = await getMission(id);
  ok(m?.status === "done", `canceled mission is terminal (status=${m?.status})`);
  ok(!m?.recurrence, "no recurrence after cancel");
}

async function testSchedulingDueGating() {
  console.log("\n[scheduling: due-gating + firing]");
  const id = await createMission({ objective: "Save a note titled 'E2E Scheduled' body fired.", delayMinutes: 1 });
  await sleep(20000);
  let m = await getMission(id);
  ok(m?.status === "queued", `not run before its time (status=${m?.status})`);
  m = await waitStatus(id, ["done", "failed"], 90000);
  ok(m?.status === "done", `fired when due (status=${m?.status})`);
}

async function testRecurrenceAndCleanup() {
  console.log("\n[recurrence: spawn + cancellation cleanup]");
  const marker = `E2E Recurring ${Date.now()}`;
  const id = await createMission({ objective: `Save a note titled '${marker}' body tick.`, delayMinutes: 0, everyMinutes: 1 });
  const first = await waitStatus(id, ["done", "failed"]);
  ok(first?.status === "done", `first run completed (status=${first?.status})`);
  await sleep(3000);
  const chain = (await listMissions()).filter((x) => x.objective.includes(marker));
  const nextQueued = chain.some((x) => x.status === "queued" && x.recurrence);
  ok(nextQueued, "next occurrence was auto-queued");

  // cleanup: cancel every instance in this chain, over one recurrence cycle
  let cleared = false;
  for (let round = 0; round < 16; round++) {
    const active = (await listMissions()).filter((x) => x.objective.includes(marker) && ["queued", "running"].includes(x.status));
    if (active.length === 0) { cleared = true; break; }
    for (const x of active) await cancel(x.id);
    await sleep(5000);
  }
  ok(cleared, "recurring chain fully stopped via cancel (no runaway)");
}

(async () => {
  console.log(`Evolution OS E2E — target: ${BASE}`);
  try {
    await testHealth();
    await testExecutionAndIdempotency();
    await testCancel();
    await testSchedulingDueGating();
    await testRecurrenceAndCleanup();
  } catch (e) {
    fail++; console.log("  ✗ FAIL unexpected error:", e?.message || e);
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
