#!/usr/bin/env node
/**
 * verify-hierarchy — proves Milestone 1: Identity → Vision → Objectives → Missions.
 *
 * Creates a Vision, an Objective linked to it, and a Mission linked to the
 * Objective, then reads /api/ops and confirms the full traceability chain
 * resolves (mission → objective → vision). Also upserts Identity and confirms it
 * round-trips. Cleans up everything it creates.
 *
 * Usage: BASE=https://<host> node scripts/verify-hierarchy.mjs
 */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0, fail = 0;
const created = { visionId: null, objectiveId: null, missionId: null };

async function rfetch(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const text = await r.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { status: r.status, json };
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
}
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

(async () => {
  console.log(`\nverify-hierarchy against ${BASE}\n`);

  // 1. Identity upsert round-trips
  const ident = { name: "Hierarchy Probe", roles: ["Founder"], values: ["Leverage"], principles: ["Least effort"], bio: "probe" };
  const putId = await rfetch("/api/identity", { method: "PUT", body: JSON.stringify(ident) });
  check("PUT /api/identity ok", putId.status === 200 && putId.json.ok);
  const getId = await rfetch("/api/identity");
  check("GET /api/identity persists name+values", getId.json?.identity?.name === "Hierarchy Probe" && (getId.json?.identity?.values || []).includes("Leverage"));

  // 2. Create Vision
  const v = await rfetch("/api/visions", { method: "POST", body: JSON.stringify({ title: "Probe Vision", description: "long-term future", horizon: "5y" }) });
  created.visionId = v.json?.vision?.id;
  check("POST /api/visions returns id", !!created.visionId, JSON.stringify(v.json).slice(0, 120));

  // 3. Create Objective linked to Vision
  const o = await rfetch("/api/objectives", { method: "POST", body: JSON.stringify({ title: "Probe Objective", description: "measurable outcome", visionId: created.visionId, metric: "count", target: "10", priority: 2 }) });
  created.objectiveId = o.json?.objective?.id;
  check("POST /api/objectives returns id", !!created.objectiveId);
  check("Objective linked to Vision", o.json?.objective?.visionId === created.visionId);

  // 4. Create Mission linked to Objective
  const m = await rfetch("/api/missions", { method: "POST", body: JSON.stringify({ objective: "[PROBE] traceability mission — do nothing meaningful", objectiveId: created.objectiveId, delayMinutes: 600 }) });
  created.missionId = m.json?.id;
  check("POST /api/missions returns id", !!created.missionId);

  // 5. Read /api/ops and confirm the full chain resolves
  const ops = await rfetch("/api/ops");
  const h = ops.json?.hierarchy;
  check("/api/ops exposes hierarchy", !!h);
  const objInOps = (h?.objectives || []).find((x) => x.id === created.objectiveId);
  check("Objective appears in ops hierarchy", !!objInOps);
  check("Objective → Vision resolves in ops", objInOps?.vision?.id === created.visionId, JSON.stringify(objInOps?.vision));
  check("Objective knows its mission (mission → objective)", (objInOps?.missionIds || []).includes(created.missionId), JSON.stringify(objInOps?.missionCounts));
  check("hierarchy counts reflect creation", (h?.counts?.visions || 0) >= 1 && (h?.counts?.objectives || 0) >= 1);
  const missionInOps = [...(ops.json?.missions?.scheduled || []), ...(ops.json?.missions?.queuedNow || [])].find((x) => x.id === created.missionId);
  check("Mission carries objectiveId in ops", missionInOps?.objectiveId === created.objectiveId, JSON.stringify(missionInOps).slice(0, 120));

  // 6. Cleanup
  if (created.missionId) await rfetch(`/api/missions/${created.missionId}/cancel`, { method: "POST" }).catch(() => {});
  if (created.objectiveId) await rfetch(`/api/objectives/${created.objectiveId}`, { method: "DELETE" });
  if (created.visionId) await rfetch(`/api/visions/${created.visionId}`, { method: "DELETE" });
  console.log("  · cleaned up probe vision/objective/mission");

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("verify-hierarchy crashed:", e); process.exit(1); });
