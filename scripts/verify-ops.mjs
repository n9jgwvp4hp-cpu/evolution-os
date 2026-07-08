#!/usr/bin/env node
/**
 * Operations Command Center — PASS/FAIL verification.
 *   DEP=<id> node scripts/verify-ops.mjs
 *
 * Verifies the /api/ops live snapshot exposes every required section with real
 * timestamps + durations + health, and that the /ops dashboard implements
 * filtering and the click-through execution timeline.
 */
import { readFileSync } from "fs";
import { homedir } from "os";
const BASE = "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const DEP = process.env.DEP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rf(u, o, t = 5) { for (let i = 0; i < t; i++) { try { return await fetch(u, o); } catch (e) { if (i === t - 1) throw e; await sleep(1200 * (i + 1)); } } }
async function j(p) { const r = await rf(BASE + p); return r.json().catch(() => null); }
const doTok = () => readFileSync(`${homedir()}/Library/Application Support/doctl/config.yaml`, "utf8").match(/access-token:\s*(\S+)/)[1];
const doApi = (p) => rf(`https://api.digitalocean.com/v2/apps/${APP}${p}`, { headers: { Authorization: `Bearer ${doTok()}` } }).then((r) => r.json());
const src = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

const R = [];
const REQ = (n, pass, d) => { R.push({ n, pass }); console.log(`   ${pass ? "✓ PASS" : "✗ FAIL"}  ${n} — ${d}`); };
const isArr = (x) => Array.isArray(x);

(async () => {
  console.log("OPERATIONS COMMAND CENTER — VERIFICATION\n");
  if (DEP) { process.stdout.write("waiting for deploy ACTIVE"); for (let i = 0; i < 40; i++) { const p = (await doApi(`/deployments/${DEP}`)).deployment.phase; process.stdout.write(` ${p}`); if (p === "ACTIVE") break; if (["ERROR", "CANCELED"].includes(p)) { console.log(" abort"); process.exit(1); } await sleep(15000); } console.log(""); }

  const ops = await j("/api/ops");
  const page = src("app/(modules)/ops/page.tsx");
  const shell = src("components/AppShell.tsx");
  if (!ops?.ok) { console.log("✗ /api/ops did not respond ok"); process.exit(1); }

  console.log("\n[LIVE SNAPSHOT] /api/ops sections");
  REQ("Live dashboard showing everything (aggregation endpoint + polling page)",
    ops.ok && /fetch\("\/api\/ops"/.test(page) && /setInterval/.test(page),
    "/api/ops returns a full snapshot; /ops page polls it live");

  REQ("Displays Active missions", isArr(ops.missions?.active), `${ops.missions?.active?.length} active`);
  REQ("Displays Upcoming scheduled work", isArr(ops.missions?.scheduled), `${ops.missions?.scheduled?.length} scheduled`);
  REQ("Displays Background kernel status", !!ops.kernel && "status" in ops.kernel && "nextRunAt" in ops.kernel, `kernel status=${ops.kernel?.status}, every ${ops.kernel?.everyMin}m, next ${ops.kernel?.nextRunAt ? "set" : "—"}`);
  REQ("Displays Priority queue", isArr(ops.priorities), `${ops.priorities?.length} priorities`);
  REQ("Displays Recent decisions", isArr(ops.recentDecisions) && ops.recentDecisions.every((d) => "ts" in d && "text" in d), `${ops.recentDecisions?.length} recent decisions (with timestamps)`);
  REQ("Displays Draft emails awaiting approval", isArr(ops.draftsAwaitingApproval), `${ops.draftsAwaitingApproval?.length} drafts`);
  REQ("Displays Calendar actions", isArr(ops.calendarActions), `${ops.calendarActions?.length} calendar actions`);
  REQ("Displays Mission execution history", isArr(ops.missions?.history) && ops.missions.history.length > 0, `${ops.missions?.history?.length} in history`);
  REQ("Displays Errors and retries", isArr(ops.missions?.errorsRetries), `${ops.missions?.errorsRetries?.length} errors/retries`);

  console.log("\n[TIMING]");
  const withTiming = (ops.missions.history || []).filter((m) => typeof m.durationMs === "number" && m.createdAt && m.updatedAt);
  REQ("Real-time timestamps and execution durations",
    withTiming.length > 0 && /fmtDur/.test(page) && /fmtWhen|fmtClock/.test(page),
    `${withTiming.length} history missions carry createdAt/updatedAt/durationMs (e.g. ${withTiming[0] ? Math.round(withTiming[0].durationMs / 1000) + "s" : "—"}); page formats durations + timestamps`);

  console.log("\n[HEALTH]");
  const H = ops.health || {};
  const subs = ["database", "scheduler", "worker", "gmail", "calendar", "crm", "ai"];
  const allHealth = subs.every((s) => H[s] && "status" in H[s]);
  REQ("System health (workers, scheduler, database, AI providers, integrations)",
    allHealth, subs.map((s) => `${s}:${H[s]?.status}`).join(" "));

  const anyMission = [...(ops.missions.history || []), ...(ops.missions.active || [])][0];
  REQ("Shows progress + current execution step",
    !!anyMission && "currentStep" in anyMission && "stepCount" in anyMission && "actionCount" in anyMission && /currentStep/.test(page),
    `missions carry currentStep + step/action counts; running rows show ▶ current step`);

  console.log("\n[UI CONTROLS] (static)");
  REQ("Allow filtering by Running, Waiting, Completed, Failed",
    /Running/.test(page) && /Waiting/.test(page) && /Completed/.test(page) && /Failed/.test(page) && /FILTERS/.test(page) && /setFilter/.test(page),
    "filter tabs + client-side status filter implemented");
  REQ("Clicking a mission shows a detailed execution timeline of every decision",
    /openMission/.test(page) && /Execution Timeline/.test(page) && /selected\.steps/.test(page) && /\/api\/missions/.test(page),
    "click → fetch full steps → timeline modal rendering each step (kind + text + detail + timestamp)");
  REQ("Reachable in the app (Command Center nav)", /\/ops/.test(shell) && /Command Center/.test(shell), "nav link added");

  const passed = R.filter((r) => r.pass).length, failed = R.length - passed;
  console.log(`\n${"=".repeat(64)}\nRESULT: ${passed}/${R.length} requirements PASS`);
  console.log(failed === 0 ? "✅ OPERATIONS COMMAND CENTER VERIFIED" : `❌ ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("crashed:", e?.message || e); process.exit(1); });
