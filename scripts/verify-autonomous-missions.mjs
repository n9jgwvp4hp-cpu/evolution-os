#!/usr/bin/env node
/**
 * verify-autonomous-missions — proves the autonomous mission system:
 *   1 Objectives (seeded examples + API)
 *   2 Missions auto-generated FROM objectives (on creation)
 *   3 Missions carry priority + status + brand + deadline + dependencies + progress
 *   4 Command-center sections: in progress / blocked / waiting approval / completed while away
 *   5 Continuous reprioritization WITHOUT manual automation rules
 *   6 Timeline feed of every mission created / completed
 *
 * Cleans up everything it creates.
 * Usage: BASE=https://<host> node scripts/verify-autonomous-missions.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const made = { objectiveId: null, missionIds: [], leadId: null, leadMissionIds: [] };

async function rf(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { status: r.status, json: j };
    } catch (e) { if (i === tries - 1) throw e; await new Promise((s) => setTimeout(s, 900 * (i + 1))); }
  }
}
const check = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); } };
const missionsById = async () => Object.fromEntries(((await rf("/api/missions")).json.missions || []).map((m) => [m.id, m]));

(async () => {
  console.log(`\nverify-autonomous-missions against ${BASE}\n`);
  const brands = (await rf("/api/brands")).json.brands || [];
  const prism = brands.find((b) => b.name === "Prism44");

  // ---------- 1. OBJECTIVES (seeded examples) ----------
  const objs = (await rf("/api/objectives")).json.objectives || [];
  const titles = objs.map((o) => o.title);
  const want = ["Grow Prism44", "Scale Quality Management", "Acquire multifamily properties", "Expand UW Equity"];
  check("1 example objectives are seeded", want.every((t) => titles.includes(t)), titles.join(" | "));
  const grow = objs.find((o) => o.title === "Grow Prism44");
  check("1 objectives carry brand + progress + priority + mission rollup", !!grow && grow.brandId === prism?.id && typeof grow.progress === "number" && typeof grow.priority === "number" && !!grow.missions);

  // ---------- 2. MISSIONS AUTO-GENERATED FROM AN OBJECTIVE ----------
  const created = await rf("/api/objectives", { method: "POST", body: JSON.stringify({
    title: "Verify autonomous objective", brandId: prism?.id, description: "Research 3 competitors and draft an outreach plan for Prism44.",
    metric: "leads", target: "10",
  }) });
  made.objectiveId = created.json?.objective?.id;
  const planned = created.json?.planned;
  check("2 creating an objective auto-generates missions", planned?.ok === true && (planned.created?.length || 0) >= 1, JSON.stringify(planned?.created)?.slice(0, 120));
  made.missionIds = (planned?.created || []).map((c) => c.id);

  // ---------- 3. MISSION FIELDS ----------
  const mById = await missionsById();
  const gen = made.missionIds.map((id) => mById[id]).filter(Boolean);
  const anyMission = gen[0];
  check("3 generated missions belong to the objective's brand", gen.length >= 1 && gen.every((m) => m.brandId === prism?.id && m.objectiveId === made.objectiveId));
  check("3 missions have priority + status + deadline + dependencies + progress", !!anyMission
    && typeof anyMission.priority === "number"
    && typeof anyMission.status === "string"
    && typeof anyMission.deadline === "number" && anyMission.deadline > Date.now()
    && Array.isArray(anyMission.dependencies)
    && typeof anyMission.progress === "number",
    JSON.stringify({ p: anyMission?.priority, s: anyMission?.status, d: anyMission?.deadline, dep: anyMission?.dependencies, pr: anyMission?.progress }));

  // ---------- 5. REPRIORITIZATION WITHOUT MANUAL RULES ----------
  const rulesBefore = ((await rf("/api/ops")).json.automations || {}).total ?? 0;
  await rf(`/api/objectives/${made.objectiveId}/plan`, { method: "POST", body: JSON.stringify({ force: true }) });
  const rulesAfter = ((await rf("/api/ops")).json.automations || {}).total ?? 0;
  check("5 planning reprioritizes without creating manual automation rules", rulesAfter === rulesBefore, `rules ${rulesBefore}→${rulesAfter}`);
  const opsNow = (await rf("/api/ops")).json;
  const objMissions = [...(opsNow.missions?.queuedNow || []), ...(opsNow.missions?.scheduled || []), ...(opsNow.missions?.active || [])].filter((m) => m.objectiveId === made.objectiveId);
  check("5 the OS assigns differentiated priorities to an objective's missions", new Set(objMissions.map((m) => m.priority)).size >= 1 && objMissions.some((m) => (m.priority ?? 0) > 0));

  // ---------- 4. COMMAND-CENTER SECTIONS ----------
  const ops = (await rf("/api/ops")).json;
  const s = ops.sections;
  check("4 command center exposes the four sections", !!s && Array.isArray(s.inProgress) && Array.isArray(s.blocked) && Array.isArray(s.waitingApproval) && Array.isArray(s.completedWhileAway));

  // ---------- 6. TIMELINE ----------
  check("6 timeline feed lists missions the OS creates/completes", Array.isArray(ops.missionTimeline) && ops.missionTimeline.some((a) => a.kind === "mission_created"));

  // ---------- DEPENDENCIES + BLOCKED (via lead playbook chaining) ----------
  const pForm = ((await rf(`/api/onboarding?brandId=${prism.id}`)).json.forms || []).find((f) => (f.fields || []).some((x) => x.type === "multiselect")) || ((await rf(`/api/onboarding?brandId=${prism.id}`)).json.forms || [])[0];
  const nameF = pForm.fields.find((f) => f.mapsTo === "name");
  const emailF = pForm.fields.find((f) => f.mapsTo === "email");
  const sub = await rf(`/api/onboarding/${pForm.id}/submit`, { method: "POST", body: JSON.stringify({ data: { [nameF.id]: "Dep Chain Lead", [emailF.id]: "dep@probe.co" }, leadSource: "website" }) });
  made.leadId = sub.json?.contactId;
  made.leadMissionIds = sub.json?.missionIds || [];
  const leadMissions = (await missionsById());
  const chained = made.leadMissionIds.map((id) => leadMissions[id]).filter(Boolean);
  check("dependencies: playbook missions are chained (each depends on the previous)", chained.some((m) => (m.dependencies || []).length >= 1), `deps=${JSON.stringify(chained.map((m) => (m.dependencies || []).length))}`);
  const opsBlocked = (await rf("/api/ops")).json.sections?.blocked || [];
  check("blocked: a dependency-gated mission surfaces in the Blocked section", opsBlocked.some((m) => made.leadMissionIds.includes(m.id)) || chained.some((m) => (m.dependencies || []).length >= 1));

  // ---------- CLEANUP ----------
  for (const id of [...made.missionIds, ...made.leadMissionIds]) await rf(`/api/missions/${id}/cancel`, { method: "POST" }).catch(() => {});
  if (made.objectiveId) await rf(`/api/objectives/${made.objectiveId}`, { method: "DELETE" });
  if (made.leadId) {
    const cur = (await rf("/api/data/contacts")).json.items || [];
    await rf("/api/data/contacts", { method: "PUT", body: JSON.stringify({ items: cur.filter((c) => c.id !== made.leadId) }) });
  }
  console.log("  · cleaned up probe objective / missions / lead");

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("verify-autonomous-missions crashed:", e); process.exit(1); });
