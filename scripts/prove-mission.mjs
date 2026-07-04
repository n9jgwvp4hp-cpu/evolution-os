#!/usr/bin/env node
/**
 * Milestone 5 proof — execute ONE complete mission, creation → completion, and
 * print the full lifecycle (plan → progress → real tool actions → result) plus
 * the real side effect it produced (a note in the brain).
 *
 *   node scripts/prove-mission.mjs
 */
const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rfetch(url, opts, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); } catch (e) { if (i === tries - 1) throw e; await sleep(1500 * (i + 1)); }
  }
}
async function j(path, opts) { const r = await rfetch(BASE + path, opts); return r.json().catch(() => null); }
const t = (ts) => new Date(ts).toISOString().slice(11, 19);

(async () => {
  const title = `Milestone 5 Proof ${Date.now()}`;
  const objective = `Create a note titled "${title}" whose body lists three concrete benefits of a persistent, always-on AI operating system. Then report what you did.`;
  console.log("EVOLUTION OS — ONE COMPLETE MISSION, CREATION → COMPLETION\n");
  console.log("BASE:", BASE);
  console.log("OBJECTIVE:", objective, "\n");

  const t0 = Date.now();
  const { id } = await j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective }) });
  console.log(`[${t(t0)}] CREATED mission ${id} (status: queued)\n`);

  let m, last = 0;
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const ms = (await j("/api/missions")).missions;
    m = ms.find((x) => x.id === id);
    if (!m) continue;
    // print any new steps since last poll
    for (const s of (m.steps || []).slice(last)) {
      console.log(`[${t(s.ts)}] ${s.kind.toUpperCase().padEnd(8)} ${s.text}${s.detail ? `  — ${s.detail}` : ""}`);
    }
    last = (m.steps || []).length;
    if (m.status === "done" || m.status === "failed") break;
  }

  console.log(`\nFINAL STATUS: ${m?.status}  (elapsed ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log("\n────────── DELIVERABLE (mission result) ──────────");
  console.log(m?.result || "(none)");

  // prove the real side effect
  const note = (await j("/api/data/notes")).items.find((n) => n.title === title);
  console.log("\n────────── REAL SIDE EFFECT (note written to the brain) ──────────");
  console.log(note ? `note "${note.title}":\n${note.body}` : "NOTE NOT FOUND");

  const success = m?.status === "done" && !!note;
  console.log(`\n${success ? "✅ MILESTONE 5 PROVEN: one complete mission executed creation → completion." : "❌ mission did not complete"}`);
  process.exit(success ? 0 : 1);
})();
