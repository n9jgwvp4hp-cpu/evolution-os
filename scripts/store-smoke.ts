/**
 * Local smoke test for the mission store (file backend — no DB needed).
 * Exercises the CRUD + lifecycle paths the engine relies on.
 *   npx tsx scripts/store-smoke.ts
 */
import { promises as fs } from "fs";
import path from "path";
import {
  createMissionRow, getMission, listMissionViews, listRunnable,
  patchMission, addStep, pushApi, clearApi, trimTerminalApi,
  cancelMissionRow, pruneMissions, missionStats,
  claimMission, extendLease, releaseLease,
} from "@/lib/server/missionStore";
import type { Mission } from "@/lib/missionTypes";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗ FAIL"} ${m}`); };

// Simulate a dead worker: push this mission's lease into the past. (File backend
// only — patch persists any field; the Postgres path is exercised in prod.)
async function forceLeaseExpired(id: string) {
  await patchMission(id, { leaseExpires: Date.now() - 1000 });
}

function mk(id: string, over: Partial<Mission> = {}): Mission {
  const now = Date.now();
  return {
    id, objective: `obj ${id}`, status: "queued",
    steps: [{ id: id + "s", ts: now, kind: "plan", text: "accepted" }],
    api: [{ role: "user", content: `obj ${id}` }],
    pending: [], qcLeft: 2, attempts: 0, acknowledged: false,
    createdAt: now, updatedAt: now, ...over,
  };
}

(async () => {
  // start clean
  await fs.rm(path.join(process.cwd(), ".data", "missions.json"), { force: true });

  // create + get
  await createMissionRow(mk("a"));
  const a = await getMission("a");
  ok(!!a && a.objective === "obj a", "create + get roundtrips");
  ok(a?.steps.length === 1 && a.api.length === 1, "initial step + api persisted");

  // addStep / pushApi
  await addStep("a", { kind: "action", text: "did a thing", detail: "ok" });
  await pushApi("a", { role: "assistant", content: "working" });
  const a2 = await getMission("a");
  ok(a2?.steps.length === 2, "addStep appended");
  ok(a2?.api.length === 2, "pushApi appended");
  ok(a2?.steps[1].detail === "ok", "step detail persisted");

  // patch (incl. recurrence + scheduledFor mapping)
  await patchMission("a", { status: "running", attempts: 1, scheduledFor: 123, recurrence: { everyMs: 60000 } });
  const a3 = await getMission("a");
  ok(a3?.status === "running" && a3?.attempts === 1, "patch scalar fields");
  ok(a3?.scheduledFor === 123 && a3?.recurrence?.everyMs === 60000, "patch scheduledFor + recurrence mapping");

  // clearApi
  await clearApi("a");
  ok((await getMission("a"))?.api.length === 0, "clearApi empties api");

  // listViews omits api, includes steps, newest first
  await createMissionRow(mk("b", { createdAt: Date.now() + 1000 }));
  const views = await listMissionViews();
  ok(views.length === 2 && views[0].id === "b", "listViews newest-first");
  ok(!("api" in (views[0] as any)), "listViews omits api");
  ok((views.find((v) => v.id === "a")?.steps.length ?? 0) === 2, "listViews includes steps");

  // listRunnable: due-gating
  await patchMission("a", { status: "queued", scheduledFor: Date.now() + 10 * 60000 }); // future
  await patchMission("b", { status: "queued", scheduledFor: undefined });               // now
  const runnable = await listRunnable(Date.now());
  ok(runnable.some((r) => r.id === "b") && !runnable.some((r) => r.id === "a"), "listRunnable gates future-scheduled");

  // cancel: recurrence cleared, terminal, acknowledged
  await patchMission("a", { recurrence: { everyMs: 60000 } });
  await cancelMissionRow("a");
  const a4 = await getMission("a");
  ok(a4?.status === "done" && !a4?.recurrence && a4?.acknowledged === true, "cancel finalizes + stops recurrence");
  ok((a4?.result || "").includes("(canceled)"), "cancel annotates result");

  // trimTerminalApi
  await pushApi("a", { role: "user", content: "stale" });
  await trimTerminalApi();
  ok((await getMission("a"))?.api.length === 0, "trimTerminalApi clears terminal api");

  // stats
  const stats = await missionStats();
  ok(typeof stats.counts === "object" && stats.apiMsgs >= 0, "missionStats returns counts + apiMsgs");

  // prune: cap keeps active + newest terminal
  for (let i = 0; i < 5; i++) await createMissionRow(mk("t" + i, { status: "done", createdAt: Date.now() + i }));
  await createMissionRow(mk("act", { status: "queued" })); // active, must survive
  await pruneMissions(3);
  const after = await listMissionViews();
  ok(after.some((v) => v.id === "act"), "prune never drops active missions");
  ok(after.length <= 3 + 2, "prune bounds terminal count near cap"); // active(b queued, a done->terminal counts) tolerance
  ok(after.some((v) => v.id === "t4") && !after.some((v) => v.id === "t0"), "prune keeps newest terminal, drops oldest");

  /* ---------- lease / cross-process atomic claim ---------- */
  await fs.rm(path.join(process.cwd(), ".data", "missions.json"), { force: true });

  // concurrent claim of ONE queued mission → exactly one winner
  await createMissionRow(mk("c1", { status: "queued" }));
  const results = await Promise.all(
    ["wA", "wB", "wC", "wD", "wE"].map((w) => claimMission("c1", w, 60_000))
  );
  ok(results.filter(Boolean).length === 1, `concurrent claim: exactly one worker wins (won=${results.filter(Boolean).length})`);
  const claimed = await getMission("c1");
  ok(claimed?.status === "running" && !!claimed?.workerId, "claimed mission is running + has an owner");

  // a second claim while the lease is valid → denied
  ok((await claimMission("c1", "wZ", 60_000)) === false, "valid lease blocks re-claim");

  // owner can extend; a non-owner cannot
  const owner = claimed!.workerId!;
  ok((await extendLease("c1", owner, 60_000)) === true, "owner extends its lease");
  ok((await extendLease("c1", "someoneElse", 60_000)) === false, "non-owner cannot extend");

  // stale lease → another worker reclaims (dead-worker recovery)
  await forceLeaseExpired("c1");
  ok((await claimMission("c1", "wNew", 60_000)) === true, "lapsed lease → reclaimed by another worker");
  ok((await getMission("c1"))?.workerId === "wNew", "reclaim transfers ownership");
  ok((await extendLease("c1", owner, 60_000)) === false, "old owner loses the lease after reclaim");

  // release clears ownership; queued mission is claimable again
  await patchMission("c1", { status: "queued" });
  await releaseLease("c1");
  const rel = await getMission("c1");
  ok(!rel?.workerId && !rel?.leaseExpires, "release clears owner + lease");

  // lease fields never leak into the UI view
  const views2 = await listMissionViews();
  ok(views2.every((v) => !("workerId" in (v as any)) && !("leaseExpires" in (v as any))), "views omit lease fields");

  // cleanup
  await fs.rm(path.join(process.cwd(), ".data", "missions.json"), { force: true });
  console.log(`\nSTORE SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
