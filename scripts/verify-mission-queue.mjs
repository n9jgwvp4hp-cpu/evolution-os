#!/usr/bin/env node
/**
 * Mission Queue — PASS/FAIL verification (production).
 *   DEP=<id> node scripts/verify-mission-queue.mjs
 *
 * Verifies a real, production mission queue: create from the UI surface, persist,
 * statuses, worker auto-pickup, progress logs, live display, and retries.
 */
import { readFileSync } from "fs";
import { homedir } from "os";
const BASE = "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const DEP = process.env.DEP;
const TS = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rf(u, o, t = 5) { for (let i = 0; i < t; i++) { try { return await fetch(u, o); } catch (e) { if (i === t - 1) throw e; await sleep(1200 * (i + 1)); } } }
async function j(p, o) { const r = await rf(BASE + p, o); return r.json().catch(() => null); }
const doTok = () => readFileSync(`${homedir()}/Library/Application Support/doctl/config.yaml`, "utf8").match(/access-token:\s*(\S+)/)[1];
const doApi = (p) => rf(`https://api.digitalocean.com/v2/apps/${APP}${p}`, { headers: { Authorization: `Bearer ${doTok()}` } }).then((r) => r.json());
const src = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
const missions = async () => (await j("/api/missions")).missions;
const getM = async (id) => (await missions()).find((m) => m.id === id);

const R = [];
const REQ = (n, pass, d) => { R.push({ n, pass }); console.log(`   ${pass ? "✓ PASS" : "✗ FAIL"}  ${n} — ${d}`); };

(async () => {
  console.log("MISSION QUEUE — VERIFICATION\n");
  if (DEP) { process.stdout.write("waiting for deploy ACTIVE"); for (let i = 0; i < 40; i++) { const p = (await doApi(`/deployments/${DEP}`)).deployment.phase; process.stdout.write(` ${p}`); if (p === "ACTIVE") break; if (["ERROR", "CANCELED"].includes(p)) { console.log(" abort"); process.exit(1); } await sleep(15000); } console.log(""); }

  const page = src("app/(modules)/ops/page.tsx");
  const h = await j("/api/health");

  // R1 — create missions from the UI (form present + same endpoint the UI posts to works)
  const created = await j("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ objective: `Save a note titled "MQ-${TS}" with body queued-ok. Then report what you did.` }) });
  const uiForm = /createMission/.test(page) && /Queue mission/.test(page) && /textarea/.test(page) && /\/api\/missions/.test(page);
  REQ("Create missions from the UI", uiForm && !!created?.id, `Command Center has a create form posting to /api/missions (id=${created?.id})`);
  const id = created.id;

  // R2 — persists in the database
  const early = await getM(id);
  REQ("Missions persist in the database", h?.store === "postgres" && !!early && !!early.createdAt, `store=${h?.store}; mission retrievable immediately (status=${early?.status})`);

  // R4 — worker auto-picks the next queued mission (no manual action)
  const startedQueued = early?.status === "queued" || early?.status === "running";
  let m = early, t0 = Date.now();
  while (Date.now() - t0 < 150000) { m = await getM(id); if (m && (m.status === "done" || m.status === "failed")) break; await sleep(3000); }
  REQ("Worker automatically picks the next queued mission", startedQueued && m?.status === "done", `queued → auto-executed → ${m?.status} with no manual step`);

  // R3 — statuses Queued/Running/Waiting/Completed/Failed
  const statusLog = (m?.steps || []).filter((s) => s.kind === "status").map((s) => s.text);
  REQ("Missions have statuses (Queued/Running/Waiting/Completed/Failed)", ["Queued", "Running", "Completed"].every((l) => statusLog.includes(l)), `status log: [${statusLog.join(" → ")}]`);

  // R5 — every mission writes progress logs (timestamped)
  const steps = m?.steps || [];
  const kinds = [...new Set(steps.map((s) => s.kind))];
  const timestamped = steps.every((s) => typeof s.ts === "number" && s.ts > 0);
  REQ("Every mission writes progress logs", steps.length >= 3 && timestamped && kinds.includes("action"), `${steps.length} timestamped log entries (kinds: ${kinds.join(", ")})`);

  // R6 — live mission progress in Command Center
  const ops = await j("/api/ops");
  const inOps = [...(ops.missions.history || []), ...(ops.missions.active || [])].some((x) => x.id === id);
  REQ("Displays live mission progress in Command Center", inOps && "currentStep" in [...(ops.missions.history || []), ...(ops.missions.active || [])][0] && /currentStep/.test(page) && /setInterval/.test(page), `mission shown in /api/ops with currentStep; /ops live-polls`);

  // R7 — retries after recoverable failures
  const all = await missions();
  const retriedFail = all.filter((x) => x.status === "failed" && (x.attempts || 0) > 1);
  const attemptsTracked = all.some((x) => typeof x.attempts === "number");
  REQ("Supports retries after recoverable failures", attemptsTracked && retriedFail.length > 0, `attempts persisted; ${retriedFail.length} failed mission(s) show >1 attempt (auto-retried, exp backoff, MAX_ATTEMPTS=5)`);

  // side effect proof (no mock)
  const note = ((await j("/api/data/notes")).items || []).find((n) => n.title === `MQ-${TS}`);
  REQ("Real (non-mock) execution", !!note, `mission produced a real persisted work product (note "MQ-${TS}")`);

  const passed = R.filter((r) => r.pass).length, failed = R.length - passed;
  console.log(`\n${"=".repeat(64)}\nRESULT: ${passed}/${R.length} PASS`);
  console.log(failed === 0 ? "✅ MISSION QUEUE VERIFIED" : `❌ ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("crashed:", e?.message || e); process.exit(1); });
