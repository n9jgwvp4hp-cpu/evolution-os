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
} from "@/lib/server/missionStore";
import type { Mission } from "@/lib/missionTypes";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗ FAIL"} ${m}`); };

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

  // cleanup
  await fs.rm(path.join(process.cwd(), ".data", "missions.json"), { force: true });
  console.log(`\nSTORE SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
