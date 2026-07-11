#!/usr/bin/env node
/**
 * simulate-live — drives a burst of genuinely-runnable missions through the REAL
 * engine and polls fast to capture missions IN PROGRESS and freshly COMPLETED.
 * Real work (research → note), no Google required. Complements simulate-week.mjs.
 */
const BASE = process.env.BASE || "http://localhost:3000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rf(path, opts = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
      return { status: r.status, json: j };
    } catch (e) { if (i === tries - 1) throw e; await sleep(700 * (i + 1)); }
  }
}
const ops = async () => (await rf("/api/ops")).json;
const short = (s, n = 66) => String(s || "").replace(/\s+/g, " ").slice(0, n);

(async () => {
  console.log(`\n=== Live autonomous execution burst · ${BASE} ===\n`);
  const brands = (await rf("/api/brands")).json.brands || [];
  const bn = (id) => brands.find((b) => b.id === id)?.name || "—";
  const objs = ((await rf("/api/objectives")).json.objectives || []).filter((o) => o.status === "active");

  const base = await ops();
  const baseDone = base.counts?.done || 0;

  // Create genuinely-runnable real missions (research → note) across the objectives.
  const topics = [
    "3 current trends in social-media content marketing",
    "3 ways property-management companies win maintenance contracts",
    "3 indicators investors use to screen multifamily acquisitions",
    "3 tactics to grow a real-estate investment firm's deal flow",
    "2 competitors and their positioning for a creative content studio",
    "2 recent multifamily market signals in secondary US metros",
  ];
  const created = [];
  for (let i = 0; i < topics.length; i++) {
    const o = objs[i % objs.length];
    const r = await rf("/api/missions", { method: "POST", body: JSON.stringify({
      objective: `Research task: find ${topics[i]}. Then save a note titled "Research ${Date.now()}-${i}" summarizing them with source URLs. Do not send email or create calendar events.`,
      brandId: o?.brandId || null, objectiveId: o?.id || null,
    }) });
    if (r.json?.id) created.push(r.json.id);
  }
  console.log(`Launched ${created.length} real runnable missions across ${objs.length} objectives. Watching the engine…\n`);

  const createdSet = new Set(created);
  let maxInProgress = 0;
  const seenRunning = new Set();
  for (let t = 0; t < 26; t++) {
    await sleep(3000);
    const o = await ops();
    const sec = o.sections || {};
    const ip = (sec.inProgress || []).filter((m) => createdSet.has(m.id));
    maxInProgress = Math.max(maxInProgress, (sec.inProgress || []).length);
    (sec.inProgress || []).forEach((m) => seenRunning.add(m.id));
    const doneNow = (o.counts?.done || 0) - baseDone;
    const doneOurs = created.filter((id) => !(sec.inProgress || []).some((m) => m.id === id)).length; // rough
    process.stdout.write(`  t+${(t + 1) * 3}s  inProgress(all)=${(sec.inProgress || []).length}  ours running=${ip.length}  fresh done(total)=${doneNow}\n`);
    if (ip.length === 0 && t > 4 && doneNow >= created.length) break;
  }

  // Final snapshot of the four sections.
  const fin = await ops();
  const s = fin.sections || {};
  const line = (m) => `    • [${bn(m.brandId)}] ${short(m.objective)} — P${m.priority ?? 0}, ${m.progress ?? 0}%, ${m.status}`;
  const sect = (title, arr) => { console.log(`\n${title}: ${arr?.length || 0}`); (arr || []).slice(0, 8).forEach((m) => console.log(line(m))); };

  console.log(`\n\n================= LIVE RESULT (real engine) =================`);
  console.log(`Fresh missions completed this burst: ${(fin.counts?.done || 0) - baseDone}`);
  console.log(`Distinct missions observed IN PROGRESS: ${seenRunning.size} (peak concurrent ${maxInProgress})`);
  sect("IN PROGRESS (point-in-time, final)", s.inProgress);
  sect("COMPLETED WHILE AWAY", s.completedWhileAway);
  sect("BLOCKED", s.blocked);
  sect("AWAITING APPROVAL", s.waitingApproval);
  console.log(`\n============================================================\n`);
})().catch((e) => { console.error("simulate-live crashed:", e); process.exit(1); });
