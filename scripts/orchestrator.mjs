#!/usr/bin/env node
/**
 * Continuous Claude Workflow Orchestrator for Evolution OS.
 *
 *   npm run orchestrate            # continuous: advance the roadmap until blocked/empty
 *   npm run orchestrate -- --once  # advance exactly one milestone
 *   npm run orchestrate:dry        # dry-run: exercise the machinery, no Claude/commit/deploy
 *   node scripts/orchestrator.mjs --milestone <id>
 *
 * For each unfinished roadmap milestone it: generates a Claude Code prompt, runs
 * the implementation, guards the diff against unsafe changes, builds + verifies,
 * commits + pushes + redeploys, checks production health, and marks the milestone
 * done — otherwise it writes a repair prompt and retries (bounded). Every phase is
 * logged to logs/ and POSTed to /api/orchestrator so the Command Center shows it.
 *
 * No external accounts: uses the local `claude` CLI, git, and the existing doctl
 * token for deploys. Safety: never auto-commits deletions of core files, changes
 * to env/secrets/.do, or new dependencies — it stashes and halts for approval.
 */
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import path from "path";

const ROOT = process.cwd();
const BASE = process.env.BASE_URL || "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = process.env.DO_APP_ID || "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const ROADMAP = path.join(ROOT, "roadmap.json");
const LOGDIR = path.join(ROOT, "logs");
const MAX_RETRIES = Number(process.env.ORCH_MAX_RETRIES || 3);
const MAX_PER_RUN = Number(process.env.ORCH_MAX_PER_RUN || 8); // backstop so a run can't loop forever
const CLAUDE_TIMEOUT_MS = Number(process.env.ORCH_CLAUDE_TIMEOUT_MS || 25 * 60_000);

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ONCE = args.includes("--once");
const NO_DEPLOY = args.includes("--no-deploy") || DRY;
const ONLY = (args[args.indexOf("--milestone") + 1] && args.includes("--milestone")) ? args[args.indexOf("--milestone") + 1] : null;

// Files that must never be deleted, and paths that must never be auto-changed.
const CORE_FILES = [
  "lib/server/missionEngine.ts", "lib/server/missionStore.ts", "lib/server/db.ts",
  "lib/server/data.ts", "lib/server/tools.ts", "lib/server/google.ts", "worker.ts",
  "app/api/ops/route.ts", "app/(modules)/ops/page.tsx", "app/api/missions/route.ts",
  "app/api/agent/route.ts", "roadmap.json", "scripts/orchestrator.mjs",
];
const PROTECTED_RE = /(^|\/)\.env|^\.do\/|secret|credential|evo-secret/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowLog = [];
const stamp = () => new Date().toISOString();
mkdirSync(LOGDIR, { recursive: true });
const LOGFILE = path.join(LOGDIR, `orchestrator-${stamp().slice(0, 10)}.log`);

function log(text) {
  const line = `[${stamp().slice(11, 19)}] ${text}`;
  console.log(line);
  try { appendFileSync(LOGFILE, line + "\n"); } catch {}
  nowLog.push({ ts: Date.now(), text });
  if (nowLog.length > 60) nowLog.shift();
}

function sh(cmd, a = []) {
  try {
    const out = execFileSync(cmd, a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024, timeout: CLAUDE_TIMEOUT_MS });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") + (e.message || "") };
  }
}
const git = (...a) => sh("git", a);

function loadRoadmap() { return JSON.parse(readFileSync(ROADMAP, "utf8")); }
function saveRoadmap(rm) { if (!DRY) writeFileSync(ROADMAP, JSON.stringify(rm, null, 2) + "\n"); }
const milestoneStatuses = (rm) => rm.milestones.map((m) => ({ id: m.id, title: m.title, status: m.status, attempts: m.attempts || 0 }));

async function postStatus(rm, partial) {
  const body = {
    running: true, phase: "idle", currentMilestone: null, attempt: 0, maxRetries: MAX_RETRIES,
    message: "", lastRunAt: Date.now(), recent: nowLog.slice(-40), milestones: milestoneStatuses(rm), ...partial,
  };
  try { await fetch(`${BASE}/api/orchestrator`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); } catch {}
}

function nextMilestone(rm) {
  return rm.milestones.find((m) =>
    (ONLY ? m.id === ONLY : true) &&
    (m.status === "pending" || (m.status === "failed" && (m.attempts || 0) < MAX_RETRIES)));
}

function buildPrompt(m, repair) {
  let p =
    `You are advancing the Evolution OS codebase (Next.js 14 + TypeScript, at ${ROOT}). ` +
    `Implement exactly this ONE milestone, with minimal, focused changes:\n\n` +
    `MILESTONE: ${m.title}\nGOAL: ${m.goal}\n\n` +
    `HARD CONSTRAINTS:\n` +
    `- Do NOT delete or break core files (mission engine, mission store, db, /ops, /api/missions, the kernel).\n` +
    `- Do NOT change env vars, secrets, or .do/ deployment config.\n` +
    `- Do NOT add new npm dependencies or paid external APIs.\n` +
    `- Keep the mission engine, autonomous kernel, voice interface, and Operations Command Center working.\n` +
    `- Ensure \`npm run build\` passes. Match the existing code style. Do not commit — just make the edits.\n`;
  if (repair) p += `\nThe previous attempt FAILED verification. Fix the cause. Failure output:\n${repair.slice(-1800)}\n`;
  return p;
}

function runClaude(prompt) {
  log("→ invoking Claude Code (headless)…");
  // Post-hoc diff guard is our safety net, so run headless with skip-permissions.
  const r = sh("claude", ["-p", prompt, "--dangerously-skip-permissions"]);
  log(r.ok ? "← Claude finished" : "← Claude exited with error");
  return r;
}

function safetyViolations() {
  const status = git("status", "--porcelain").out || "";
  const lines = status.split("\n").filter(Boolean);
  const violations = [];
  for (const l of lines) {
    const flag = l.slice(0, 2);
    const file = l.slice(3).trim().replace(/^"|"$/g, "");
    if ((flag.includes("D")) && CORE_FILES.includes(file)) violations.push(`deletes core file ${file}`);
    if (PROTECTED_RE.test(file)) violations.push(`touches protected path ${file}`);
  }
  if (lines.some((l) => l.slice(3).trim() === "package.json")) {
    const diff = git("diff", "--", "package.json").out + git("diff", "--cached", "--", "package.json").out;
    if (/^\+\s*"[^"]+":\s*"[\^~\d]/m.test(diff)) violations.push("adds an npm dependency (needs approval)");
  }
  return [...new Set(violations)];
}

function verify(m) {
  const steps = ["npm run build", ...(m.verify || [])];
  for (const cmd of steps) {
    log(`  verify: ${cmd}`);
    const [c, ...a] = cmd.split(" ");
    const r = sh(c, a);
    if (!r.ok) return { ok: false, failed: cmd, out: r.out };
  }
  return { ok: true };
}

function doToken() {
  try { return readFileSync(path.join(homedir(), "Library/Application Support/doctl/config.yaml"), "utf8").match(/access-token:\s*(\S+)/)[1]; } catch { return null; }
}
async function deploy(m) {
  git("add", "-A");
  const c = git("commit", "-m", `orchestrator: ${m.id} — ${m.title}`);
  if (!c.ok && !/nothing to commit/.test(c.out)) log("  commit note: " + c.out.slice(0, 120));
  const push = git("push", "origin", "HEAD");
  if (!push.ok) return { ok: false, detail: "git push failed: " + push.out.slice(0, 160) };
  const token = doToken();
  if (!token) return { ok: false, detail: "no doctl token for deploy" };
  const r = await fetch(`https://api.digitalocean.com/v2/apps/${APP}/deployments`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ force_build: true }) });
  const dep = (await r.json())?.deployment?.id;
  if (!dep) return { ok: false, detail: "deploy not triggered" };
  log(`  deploy ${dep} — waiting for ACTIVE…`);
  for (let i = 0; i < 45; i++) {
    const p = (await (await fetch(`https://api.digitalocean.com/v2/apps/${APP}/deployments/${dep}`, { headers: { Authorization: `Bearer ${token}` } })).json())?.deployment?.phase;
    if (p === "ACTIVE") return { ok: true };
    if (["ERROR", "CANCELED"].includes(p)) return { ok: false, detail: `deploy ${p}` };
    await sleep(15000);
  }
  return { ok: false, detail: "deploy timed out" };
}

async function prodHealth() {
  try {
    const h = await (await fetch(`${BASE}/api/health`)).json();
    const opsRes = await fetch(`${BASE}/api/ops`);
    if (!h?.ok || h?.worker?.alive !== true) return { ok: false, detail: `health worker alive=${h?.worker?.alive}` };
    if (!opsRes.ok) return { ok: false, detail: `/api/ops -> ${opsRes.status}` };
    return { ok: true, detail: `worker alive, store=${h.store}` };
  } catch (e) { return { ok: false, detail: "health fetch failed: " + (e?.message || e) }; }
}

// ------------------------------------------------------------------ main
(async () => {
  const rm = loadRoadmap();
  log(`Orchestrator start — ${DRY ? "DRY-RUN" : ONCE ? "ONE milestone" : "continuous"}${ONLY ? ` (only ${ONLY})` : ""} · maxRetries ${MAX_RETRIES}`);
  await postStatus(rm, { phase: "idle", message: "starting" });

  let advanced = 0;
  while (advanced < (ONCE ? 1 : MAX_PER_RUN)) {
    const m = nextMilestone(rm);
    if (!m) { log("No unfinished milestones. ✔"); await postStatus(rm, { running: false, phase: "idle", message: "roadmap complete / nothing to do" }); break; }

    log(`\n=== Milestone: ${m.id} — ${m.title} ===`);
    m.status = "in_progress"; saveRoadmap(rm);
    let attempt = m.attempts || 0, success = false, repair = null;

    while (attempt < MAX_RETRIES && !success) {
      attempt++;
      await postStatus(rm, { phase: "implementing", currentMilestone: m.id, attempt, message: `attempt ${attempt}/${MAX_RETRIES}` });
      if (DRY) log("[dry-run] would invoke Claude to implement");
      else { const r = runClaude(buildPrompt(m, repair)); if (!r.ok) { repair = r.out; log("Claude errored; will retry"); continue; } }

      if (!DRY) {
        const v = safetyViolations();
        if (v.length) {
          log("⛔ SAFETY: " + v.join("; "));
          git("stash", "push", "-u", "-m", `orchestrator-blocked-${m.id}`);
          m.status = "blocked"; m.attempts = attempt; saveRoadmap(rm);
          await postStatus(rm, { running: false, phase: "blocked", currentMilestone: m.id, message: "needs approval: " + v.join("; ") + " (changes stashed)" });
          log("Halted for approval. Review with `git stash list`."); process.exit(2);
        }
      }

      await postStatus(rm, { phase: "verifying", currentMilestone: m.id, attempt });
      const v = verify(m);
      if (!v.ok) { repair = `Build/verify failed at "${v.failed}":\n${v.out}`; log(`✗ verify failed: ${v.failed}`); continue; }
      log("✓ build + verify passed");

      if (!NO_DEPLOY) {
        await postStatus(rm, { phase: "deploying", currentMilestone: m.id, attempt });
        const d = await deploy(m);
        if (!d.ok) { repair = "Deploy failed: " + d.detail; log("✗ " + d.detail); continue; }
        await postStatus(rm, { phase: "health-check", currentMilestone: m.id, attempt });
        const h = await prodHealth();
        if (!h.ok) { repair = "Production health failed: " + h.detail; log("✗ prod health: " + h.detail); continue; }
        log("✓ deployed + production healthy");
      } else {
        const h = await prodHealth(); // read-only health probe even when not deploying
        log(`[no-deploy] production health: ${h.ok ? "OK" : "FAIL"} (${h.detail})`);
      }

      success = true;
    }

    m.attempts = attempt;
    if (success) {
      if (!DRY) m.status = "done";
      saveRoadmap(rm); advanced++;
      log(`✅ Milestone ${m.id} ${DRY ? "(dry-run OK, not marked done)" : "COMPLETED"}`);
      await postStatus(rm, { phase: "done", currentMilestone: m.id, message: `completed ${m.id}` });
      if (DRY) break; // dry-run proves one pass; don't loop
    } else {
      m.status = "failed"; saveRoadmap(rm);
      log(`❌ Milestone ${m.id} FAILED after ${attempt} attempts — halting for review`);
      await postStatus(rm, { running: false, phase: "failed", currentMilestone: m.id, message: `failed after ${attempt} attempts` });
      process.exit(1);
    }
  }

  await postStatus(rm, { running: false, phase: "idle", message: `run complete — advanced ${advanced} milestone(s)` });
  log(`Done. Advanced ${advanced} milestone(s).`);
})().catch((e) => { log("orchestrator crashed: " + (e?.message || e)); process.exit(1); });
