#!/usr/bin/env node
/**
 * Persistent runner for the Continuous Workflow Orchestrator.
 *
 * A safe, long-lived loop that keeps advancing roadmap.json without you running
 * `npm run orchestrate` by hand. Managed via scripts/orchestratord.sh:
 *   npm run orchestrate:start | :stop | :status | :logs
 *
 * SAFETY (no infinite loops / no uncontrolled spending):
 *   - Runs a milestone ONLY when roadmap.json has an unfinished one; otherwise it
 *     just polls quietly (no Claude, no spend).
 *   - Hard caps: at most ORCH_DAILY_MAX milestones per calendar day, and
 *     ORCH_SESSION_MAX per daemon start; a minimum ORCH_INTERVAL_MIN between runs.
 *   - Each milestone's own retries are bounded by the orchestrator (MAX_RETRIES).
 *   - If a milestone's build / deploy / production-health fails (orchestrator
 *     exits non-zero), the daemon STOPS and reports instead of retrying forever.
 * Every run is logged to logs/, and live status is posted to /api/orchestrator
 * (mode="daemon", with nextRunAt) so the Operations Command Center shows it.
 */
import { execFileSync } from "child_process";
import { readFileSync, appendFileSync, mkdirSync } from "fs";
import path from "path";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const ROADMAP = path.join(ROOT, "roadmap.json");
const LOGDIR = path.join(ROOT, "logs");
const INTERVAL_MIN = Number(process.env.ORCH_INTERVAL_MIN || 30);   // min spacing between milestone runs
const IDLE_MIN = Number(process.env.ORCH_IDLE_MIN || 60);           // poll interval when there's no work
const DAILY_MAX = Number(process.env.ORCH_DAILY_MAX || 6);          // spend cap: milestones per day
const SESSION_MAX = Number(process.env.ORCH_SESSION_MAX || 20);     // spend cap: milestones per daemon start
const MAX_RETRIES = Number(process.env.ORCH_MAX_RETRIES || 3);
const CYCLE_TIMEOUT_MS = Number(process.env.ORCH_CYCLE_TIMEOUT_MS || 45 * 60_000);

mkdirSync(LOGDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString();
const nowLog = [];
function log(text) {
  const line = `[${stamp().slice(0, 19).replace("T", " ")}] ${text}`;
  console.log(line);
  try { appendFileSync(path.join(LOGDIR, `daemon-${stamp().slice(0, 10)}.log`), line + "\n"); } catch {}
  nowLog.push({ ts: Date.now(), text }); if (nowLog.length > 60) nowLog.shift();
}

const loadRoadmap = () => { try { return JSON.parse(readFileSync(ROADMAP, "utf8")); } catch { return { milestones: [] }; } };
const milestoneStatuses = (rm) => rm.milestones.map((m) => ({ id: m.id, title: m.title, status: m.status, attempts: m.attempts || 0 }));
const unfinished = (rm) => rm.milestones.filter((m) => m.status === "pending" || (m.status === "failed" && (m.attempts || 0) < MAX_RETRIES));

async function postStatus(rm, partial) {
  const body = {
    running: true, mode: "daemon", phase: "idle", currentMilestone: null, attempt: 0, maxRetries: MAX_RETRIES,
    message: "", lastRunAt: Date.now(), nextRunAt: null, recent: nowLog.slice(-40), milestones: milestoneStatuses(rm), ...partial,
  };
  try { await fetch(`${BASE}/api/orchestrator`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch {}
}

function runOnce() {
  try {
    const out = execFileSync("node", ["scripts/orchestrator.mjs", "--once"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
      timeout: CYCLE_TIMEOUT_MS, env: { ...process.env, ORCH_MODE: "daemon" },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") + (e.message || "") };
  }
}

let stopping = false;
async function shutdown(sig) {
  stopping = true;
  log(`received ${sig} — stopping persistent runner`);
  await postStatus(loadRoadmap(), { running: false, phase: "stopped", message: `stopped (${sig})` });
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ---- daily spend counter ----
let dayKey = stamp().slice(0, 10);
let runsToday = 0, sessionRuns = 0;
const rollDay = () => { const d = stamp().slice(0, 10); if (d !== dayKey) { dayKey = d; runsToday = 0; log("new day — daily counter reset"); } };

(async () => {
  log(`Persistent runner started · interval ${INTERVAL_MIN}m · idle poll ${IDLE_MIN}m · caps: ${DAILY_MAX}/day, ${SESSION_MAX}/session`);
  await postStatus(loadRoadmap(), { phase: "idle", message: "persistent runner started" });

  while (!stopping) {
    rollDay();
    const rm = loadRoadmap();
    const pending = unfinished(rm);

    if (pending.length === 0) {
      const next = Date.now() + IDLE_MIN * 60_000;
      log(`idle — no unfinished milestones. next check ${IDLE_MIN}m.`);
      await postStatus(rm, { phase: "idle", currentMilestone: null, message: "idle — all milestones complete; watching roadmap.json", nextRunAt: next });
      await sleep(IDLE_MIN * 60_000); continue;
    }
    if (sessionRuns >= SESSION_MAX) {
      log(`session cap reached (${SESSION_MAX}) — stopping. restart to continue.`);
      await postStatus(rm, { running: false, phase: "stopped", message: `session cap reached (${SESSION_MAX} milestones); restart to continue` });
      break;
    }
    if (runsToday >= DAILY_MAX) {
      const next = Date.now() + IDLE_MIN * 60_000;
      log(`daily cap reached (${DAILY_MAX}/day) — pausing until it rolls over.`);
      await postStatus(rm, { phase: "idle", message: `daily cap reached (${DAILY_MAX}/day) — paused`, nextRunAt: next });
      await sleep(IDLE_MIN * 60_000); continue;
    }

    const target = pending[0];
    runsToday++; sessionRuns++;
    log(`▶ advancing milestone "${target.id}" (run ${sessionRuns}/${SESSION_MAX} this session, ${runsToday}/${DAILY_MAX} today)`);
    await postStatus(rm, { phase: "implementing", currentMilestone: target.id, message: `daemon running ${target.id}` });

    const { code, out } = runOnce();
    const rm2 = loadRoadmap();

    if (code === 0) {
      const next = Date.now() + INTERVAL_MIN * 60_000;
      log(`✓ "${target.id}" cycle finished. next milestone in ${INTERVAL_MIN}m.`);
      await postStatus(rm2, { phase: "idle", currentMilestone: null, message: `advanced ${target.id}; next run scheduled`, nextRunAt: next });
      await sleep(INTERVAL_MIN * 60_000);
    } else {
      const tail = out.split("\n").filter(Boolean).slice(-6).join(" | ").slice(0, 400);
      log(`✗ "${target.id}" failed (exit ${code}). STOPPING and reporting. ${tail}`);
      await postStatus(rm2, { running: false, phase: code === 2 ? "blocked" : "failed", currentMilestone: target.id, message: `STOPPED: ${target.id} exited ${code} (build/deploy/health). ${tail}` });
      break;
    }
  }
  log("persistent runner exited.");
})().catch((e) => { log("daemon crashed: " + (e?.message || e)); process.exit(1); });
