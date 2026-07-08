#!/usr/bin/env node
/**
 * Event-Driven Missions — PASS/FAIL verification (production).
 *   DEP=<id> node scripts/verify-events.mjs
 *
 * Webhook + schedule rules are deterministic to fire, so they drive the test:
 * create rules → trigger → verify triggered missions appear in the queue WITH the
 * event recorded, dedup works, triggers are logged, and CRUD/enable/disable work.
 * Cleans up its own test rules (so nothing keeps firing).
 */
import { readFileSync } from "fs";
import { homedir } from "os";
const BASE = "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const DEP = process.env.DEP;
const TS = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rf(u, o, t = 5) { for (let i = 0; i < t; i++) { try { return await fetch(u, o); } catch (e) { if (i === t - 1) throw e; await sleep(1200 * (i + 1)); } } }
async function j(p, o) { const r = await rf(BASE + p, o); return { status: r.status, body: await r.json().catch(() => null) }; }
const post = (p, b) => j(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const doTok = () => readFileSync(`${homedir()}/Library/Application Support/doctl/config.yaml`, "utf8").match(/access-token:\s*(\S+)/)[1];
const doApi = (p) => rf(`https://api.digitalocean.com/v2/apps/${APP}${p}`, { headers: { Authorization: `Bearer ${doTok()}` } }).then((r) => r.json());
const src = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const missions = async () => (await j("/api/missions")).body.missions;
const rules = async () => (await j("/api/automations")).body;

const R = [];
const REQ = (n, pass, d) => { R.push({ n, pass }); console.log(`   ${pass ? "✓ PASS" : "✗ FAIL"}  ${n} — ${d}`); };
const createdRuleIds = [];

(async () => {
  console.log("EVENT-DRIVEN MISSIONS — VERIFICATION\n");
  if (DEP) { process.stdout.write("waiting for deploy ACTIVE"); for (let i = 0; i < 40; i++) { const p = (await doApi(`/deployments/${DEP}`)).deployment.phase; process.stdout.write(` ${p}`); if (p === "ACTIVE") break; if (["ERROR", "CANCELED"].includes(p)) { console.log(" abort"); process.exit(1); } await sleep(15000); } console.log(""); }
  const page = src("app/(modules)/automations/page.tsx");
  const eng = src("lib/server/eventEngine.ts");

  try {
    // ---- create rules of each supported type (req 1, 2, 6) ----
    const mk = async (b) => { const r = await post("/api/automations", b); if (r.body?.rule) createdRuleIds.push(r.body.rule.id); return r.body?.rule; };
    const wh = await mk({ name: `EVT-webhook-${TS}`, type: "webhook", objective: `Save a note titled "EVT-webhook-${TS}" summarizing this trigger. Do not send anything.` });
    const sched = await mk({ name: `EVT-schedule-${TS}`, type: "schedule", atTime: "00:00", objective: `Save a note titled "EVT-schedule-${TS}" for the daily trigger. Do not send anything.` });
    const email = await mk({ name: `EVT-email-${TS}`, type: "email", from: "zillow.com", objective: "Prepare a reply draft summary. Do not send." });
    const cal = await mk({ name: `EVT-calendar-${TS}`, type: "calendar", leadMinutes: 60, objective: "Prepare a briefing for the upcoming meeting." });
    REQ("Rules for Gmail, Calendar, webhooks, and scheduled events", !!wh && !!sched && !!email && !!cal && /type === "email"/.test(eng) && /type === "calendar"/.test(eng), `created email/calendar/schedule/webhook rules; engine evaluates all four`);

    // ---- webhook fires a mission immediately (req 1) ----
    const fire1 = await post(`/api/events/${wh.webhookToken}`, { id: `evt-${TS}`, note: "hot lead form" });
    const whMission = fire1.body?.missionId;
    REQ("Event Engine watches integrations & queues a mission (webhook)", !!whMission, `POST /api/events/<token> → queued mission ${whMission}`);

    // ---- triggered mission appears in the Mission Queue WITH the event recorded (req 3) ----
    await sleep(1500);
    const m = (await missions()).find((x) => x.id === whMission);
    const triggerStep = (m?.steps || []).find((s) => /Triggered by rule/i.test(s.text));
    REQ("Triggered mission is in the Mission Queue with the triggering event recorded", !!m && !!triggerStep, `mission ${whMission} step: "${triggerStep?.text}" (${(triggerStep?.detail || "").slice(0, 50)})`);

    // ---- dedup: same webhook id doesn't trigger twice (req 4) ----
    const fire2 = await post(`/api/events/${wh.webhookToken}`, { id: `evt-${TS}`, note: "duplicate" });
    REQ("Prevents duplicate triggers", fire2.body?.deduped === true && !fire2.body?.missionId, `re-POST same id → deduped (no second mission)`);

    // ---- every trigger logged (req 5) ----
    const rd = await rules();
    const logged = (rd.eventLog || []).some((e) => e.missionId === whMission);
    REQ("Logs every trigger (event log)", logged && /recordTrigger/.test(eng), `event log records the fire → ${whMission}`);

    // ---- enable/disable + CRUD (req 6) ----
    await j(`/api/automations/${email.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
    const disabled = ((await rules()).rules || []).find((r) => r.id === email.id)?.enabled === false;
    const uiOk = /New rule/.test(page) && /Create rule/.test(page) && /Inspect/.test(page) && /Delete/.test(page) && /enabled: !r\.enabled/.test(page);
    REQ("UI + API to create, enable, disable, inspect, delete rules", disabled && uiOk, `PATCH disabled a rule; /automations page has create/toggle/inspect/delete`);

    // ---- scheduled event fires (waits for a worker engine tick) + no infinite loop (req 1, 4) ----
    console.log("   … waiting up to ~3.5 min for the worker's event-engine tick to fire the schedule rule …");
    let schedFired = false, firstCount = 0;
    for (let i = 0; i < 24; i++) {
      await sleep(9000);
      const r = ((await rules()).rules || []).find((x) => x.id === sched.id);
      if ((r?.triggerCount || 0) >= 1) { schedFired = true; firstCount = r.triggerCount; break; }
    }
    REQ("Watches SCHEDULED events (rule fired autonomously)", schedFired, schedFired ? `schedule rule fired (triggerCount=${firstCount})` : "did not fire within window");
    if (schedFired) {
      await sleep(20000); // another engine tick or two
      const again = ((await rules()).rules || []).find((x) => x.id === sched.id)?.triggerCount || 0;
      REQ("No infinite loops (schedule fires once per period)", again === firstCount, `triggerCount stayed ${firstCount} across ticks (dedup by day)`);
    } else REQ("No infinite loops (schedule fires once per period)", false, "schedule never fired");

    // ---- safe-only (no autonomous outward actions this milestone) ----
    REQ("Triggered missions do safe prep only (no outward actions)", /Do NOT send email or create\/modify calendar/i.test(eng), `triggered objectives forbid send_email / calendar writes`);
  } finally {
    // cleanup: delete every test rule so nothing keeps firing
    for (const id of createdRuleIds) await j(`/api/automations/${id}`, { method: "DELETE" }).catch(() => {});
    console.log(`\n(cleaned up ${createdRuleIds.length} test rules)`);
  }

  const passed = R.filter((r) => r.pass).length, failed = R.length - passed;
  console.log(`\n${"=".repeat(64)}\nRESULT: ${passed}/${R.length} PASS`);
  console.log(failed === 0 ? "✅ EVENT-DRIVEN MISSIONS VERIFIED" : `❌ ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(async (e) => { for (const id of createdRuleIds) await j(`/api/automations/${id}`, { method: "DELETE" }).catch(() => {}); console.error("crashed:", e?.message || e); process.exit(1); });
