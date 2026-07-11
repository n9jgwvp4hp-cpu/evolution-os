#!/usr/bin/env node
/**
 * verify-objective-reasoning — proves Milestone 2 (Objective Reasoning).
 *
 * Objectives are the primary planning unit: the planner reasons about an active
 * objective and autonomously CREATES, PRIORITIZES, PAUSES, RESUMES, and
 * REPRIORITIZES missions, picks the highest-value next mission, updates the
 * objective's evolving state, and publishes its Priority-Queue slice — deduped
 * and capped so it can never loop. Also exercises the mission lifecycle
 * primitives (pause/resume/reprioritize) directly. Cleans up.
 *
 * Usage: BASE=https://<host> node scripts/verify-objective-reasoning.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const created = { visionId: null, objectiveId: null, standaloneMissionId: null };

async function rfetch(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { status: r.status, json };
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 900 * (i + 1)));
    }
  }
}
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const missionsFor = async (objId) => {
  const { json } = await rfetch("/api/missions");
  return (json.missions || []).filter((m) => m.objectiveId === objId);
};
const OPEN = ["queued", "running", "needs_approval", "paused"];

(async () => {
  console.log(`\nverify-objective-reasoning against ${BASE}\n`);

  // --- Setup: a concrete objective the planner can clearly act on ---
  const v = await rfetch("/api/visions", { method: "POST", body: JSON.stringify({ title: "Build UW Equity portfolio", description: "long-term" }) });
  created.visionId = v.json?.vision?.id;
  const o = await rfetch("/api/objectives", {
    method: "POST",
    body: JSON.stringify({
      title: "Grow Prism44",
      description: "Prism44 is an early-stage product. Research the competitive landscape, identify 5 comparable competitors, and prepare an outreach plan. Draft (never send) initial outreach.",
      visionId: created.visionId, metric: "qualified leads", target: "20", current: "0", priority: 4,
      plan: false, // this suite tests the explicit /plan endpoint, so skip auto-plan-on-create
    }),
  });
  created.objectiveId = o.json?.objective?.id;
  check("setup: objective created", !!created.objectiveId);
  check("setup: objective starts unreviewed", o.json?.objective?.lastReviewedAt == null && (o.json?.objective?.state === "new" || !o.json?.objective?.state));

  // --- 1. Run the planner on demand ("Grow Prism44") ---
  const p1 = await rfetch(`/api/objectives/${created.objectiveId}/plan`, { method: "POST", body: JSON.stringify({ force: true }) });
  const plan = p1.json?.plan;
  check("planner ran ok", p1.json?.ok === true && !!plan, JSON.stringify(p1.json).slice(0, 200));
  check("planner created ≥1 mission for the objective", (plan?.created?.length || 0) >= 1, JSON.stringify(plan?.created));
  check("planner chose a highest-value next mission", !!plan?.highestValueMissionId);
  check("planner reported progress (0-100)", typeof plan?.progress === "number" && plan.progress >= 0 && plan.progress <= 100);
  check("planner published Priority-Queue items", (plan?.prioritiesPublished || 0) >= 1, `published=${plan?.prioritiesPublished}`);

  // --- 2. Missions are LINKED to the objective + prioritized ---
  const afterPlan = await missionsFor(created.objectiveId);
  const openAfter1 = afterPlan.filter((m) => OPEN.includes(m.status));
  check("created missions carry objectiveId (traceability)", openAfter1.length >= 1);
  const hv = afterPlan.find((m) => m.id === plan?.highestValueMissionId);
  check("highest-value mission has the top priority", !!hv && hv.priority === Math.max(...openAfter1.map((m) => m.priority ?? 0)), `hv.priority=${hv?.priority}`);

  // --- 3. Memory influenced planning: objective state evolved + timestamped ---
  const objAfter = (await rfetch("/api/objectives")).json.objectives.find((x) => x.id === created.objectiveId);
  check("objective state evolved (planner memory)", !!objAfter?.state && objAfter.state !== "new" && objAfter.state.length > 5, objAfter?.state?.slice(0, 60));
  check("objective lastReviewedAt set", typeof objAfter?.lastReviewedAt === "number");

  // --- 4. Anti-loop: re-running does NOT multiply near-duplicate missions ---
  const before2 = (await missionsFor(created.objectiveId)).filter((m) => OPEN.includes(m.status)).length;
  await rfetch(`/api/objectives/${created.objectiveId}/plan`, { method: "POST", body: JSON.stringify({ force: true }) });
  const after2 = (await missionsFor(created.objectiveId)).filter((m) => OPEN.includes(m.status)).length;
  check("re-plan does not runaway (dedup + cap ≤6 open)", after2 <= 6 && after2 - before2 <= 3, `open ${before2}→${after2}`);

  // --- 5. Objective-scoped Priority Queue surfaces in /api/ops with traceability ---
  const ops = await rfetch("/api/ops");
  const oInOps = (ops.json?.hierarchy?.objectives || []).find((x) => x.id === created.objectiveId);
  check("ops shows objective's highest-value mission", !!oInOps?.highestValueMission, JSON.stringify(oInOps?.missionCounts));
  const scopedPriorities = (ops.json?.priorities || []).filter((pr) => pr.objectiveId === created.objectiveId);
  check("Priority Queue items are objective-scoped", scopedPriorities.length >= 1, `scoped=${scopedPriorities.length}`);

  // --- 6. Mission lifecycle primitives (pause → resume → reprioritize) ---
  const sm = await rfetch("/api/missions", { method: "POST", body: JSON.stringify({ objective: "[PROBE] lifecycle mission — no-op", objectiveId: created.objectiveId, delayMinutes: 600 }) });
  created.standaloneMissionId = sm.json?.id;
  const statusOf = async (id) => (await rfetch("/api/missions")).json.missions.find((m) => m.id === id);
  await rfetch(`/api/missions/${created.standaloneMissionId}/pause`, { method: "POST", body: "{}" });
  check("pauseMission → status paused (not runnable)", (await statusOf(created.standaloneMissionId))?.status === "paused");
  await rfetch(`/api/missions/${created.standaloneMissionId}/resume`, { method: "POST", body: "{}" });
  check("resumeMission → back to queued", (await statusOf(created.standaloneMissionId))?.status === "queued");
  await rfetch(`/api/missions/${created.standaloneMissionId}/reprioritize`, { method: "POST", body: JSON.stringify({ priority: 77 }) });
  check("reprioritizeMission → priority applied", (await statusOf(created.standaloneMissionId))?.priority === 77);

  // --- Cleanup: cancel every mission for the objective, then delete objective+vision ---
  for (const m of await missionsFor(created.objectiveId)) {
    if (!["done", "failed"].includes(m.status)) await rfetch(`/api/missions/${m.id}/cancel`, { method: "POST" }).catch(() => {});
  }
  if (created.objectiveId) await rfetch(`/api/objectives/${created.objectiveId}`, { method: "DELETE" });
  if (created.visionId) await rfetch(`/api/visions/${created.visionId}`, { method: "DELETE" });
  console.log("  · cleaned up probe objective/vision/missions");

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("verify-objective-reasoning crashed:", e); process.exit(1); });
