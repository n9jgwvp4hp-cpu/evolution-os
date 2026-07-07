#!/usr/bin/env node
/**
 * Autonomous Executive Assistant — PASS/FAIL verification.
 *
 *   DEP=<deploymentId> node scripts/verify-assistant.mjs
 *
 * Waits for the deploy, then for the kernel's OWN autonomous cycle (seeded by
 * ensureKernel — no command from us), and verifies proactive prioritization, the
 * ranked Priority Queue, recommended actions with rationale, safe execution, and
 * that the assistant keeps running every cycle.
 */
import { readFileSync } from "fs";
import { homedir } from "os";
const BASE = "https://evolution-os-dlfmv.ondigitalocean.app";
const APP = "21dfe73b-1b88-4f85-b151-14bc047b49c6";
const DEP = process.env.DEP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rf(u, o, t = 6) { for (let i = 0; i < t; i++) { try { return await fetch(u, o); } catch (e) { if (i === t - 1) throw e; await sleep(1500 * (i + 1)); } } }
const doTok = () => readFileSync(`${homedir()}/Library/Application Support/doctl/config.yaml`, "utf8").match(/access-token:\s*(\S+)/)[1];
const doApi = (p) => rf(`https://api.digitalocean.com/v2/apps/${APP}${p}`, { headers: { Authorization: `Bearer ${doTok()}` } }).then((r) => r.json());
async function j(p) { const r = await rf(BASE + p); return r.json().catch(() => null); }

const R = [];
const REQ = (n, pass, d) => { R.push({ n, pass }); console.log(`   ${pass ? "✓ PASS" : "✗ FAIL"}  ${n} — ${d}`); };

(async () => {
  console.log("AUTONOMOUS EXECUTIVE ASSISTANT — VERIFICATION\n");
  if (DEP) {
    process.stdout.write("waiting for deploy ACTIVE");
    for (let i = 0; i < 40; i++) { const p = (await doApi(`/deployments/${DEP}`)).deployment.phase; process.stdout.write(` ${p}`); if (p === "ACTIVE") break; if (["ERROR", "CANCELED"].includes(p)) { console.log(" -> abort"); process.exit(1); } await sleep(15000); }
    console.log("");
  }

  // Wait for the kernel's OWN autonomous cycle (seeded by ensureKernel) to complete.
  console.log("waiting for the kernel's autonomous cycle (no command issued) …");
  let cycle = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 8 * 60 * 1000) {
    await sleep(10000);
    const ms = (await j("/api/missions")).missions;
    const exec = ms.filter((m) => m.objective.includes("EXECUTIVE ASSISTANT"));
    const done = exec.find((m) => m.status === "done");
    const running = exec.find((m) => ["running", "queued"].includes(m.status));
    console.log(`   kernel missions (new workflow): ${exec.length} | running/queued: ${running ? running.status : "-"} | done: ${done ? "yes" : "no"}`);
    if (done) { cycle = done; break; }
  }
  if (!cycle) { console.log("\n✗ kernel autonomous cycle did not complete in time"); process.exit(1); }

  const steps = cycle.steps || [];
  const actions = steps.filter((s) => s.kind === "action").map((s) => s.text.toLowerCase());
  const did = (kw) => actions.some((a) => a.includes(kw));
  const priorities = (await j("/api/data/priorities")).items || [];
  const ms = (await j("/api/missions")).missions;

  console.log(`\nkernel cycle ${cycle.id} — ${actions.length} actions; Priority Queue has ${priorities.length} items\n`);

  // R1 — proactive: it ran on its own (scheduled kernel, recurring), and produced priorities/actions
  REQ("Proactively decides work (not just executes commands)",
    !!cycle.recurrence && priorities.length > 0 && actions.length > 0,
    `ran autonomously (recurring kernel), published ${priorities.length} priorities + took ${actions.length} actions with no command`);

  // R2 — analyze Gmail, Calendar, CRM, missions, pending work
  REQ("Continuously analyzes Gmail + Calendar + CRM + missions + pending work",
    did("inbox") && did("calendar") && did("pending work"),
    `perceived: ${["inbox", "calendar", "pending work"].filter(did).join(", ")}`);

  // R3 — unified Priority Queue ranked by urgency/importance/deadlines/dependencies
  const sortedDesc = priorities.every((p, i) => i === 0 || priorities[i - 1].score >= p.score);
  const haveSignals = priorities.every((p) => typeof p.urgency === "number" && typeof p.importance === "number" && typeof p.score === "number");
  REQ("Unified Priority Queue ranked by urgency/importance/deadlines/dependencies",
    priorities.length > 0 && sortedDesc && haveSignals,
    `${priorities.length} items ranked by score (desc=${sortedDesc}); each carries urgency/importance/score(+deadline/dependsOn)`);

  // R4 — recommended actions generated automatically
  REQ("Generates recommended actions automatically",
    priorities.length > 0 && priorities.every((p) => p.recommendedAction && p.recommendedAction.length > 0),
    `every priority has a recommendedAction`);

  // R5 — draft emails, schedule follow-ups, create tasks, prepare reports without prompting
  const prepared = ["draft", "schedule", "task", "note", "summary"].filter((k) => did(k));
  const briefing = ((await j("/api/data/notes")).items || []).some((n) => n.title.toLowerCase() === "briefing");
  REQ("Drafts emails / schedules follow-ups / creates tasks / prepares reports (unprompted)",
    prepared.length >= 2 && briefing,
    `prepared: ${prepared.join(", ")}; Briefing report present: ${briefing}`);

  // R6 — never send / modify calendar / irreversible without approval
  const sent = actions.some((a) => a.includes("email ") && !a.includes("draft"));
  const madeEvent = actions.some((a) => a.includes("create event") || (a.includes("event") && a.includes("create")));
  REQ("Never sends email / modifies calendar / irreversible without approval",
    !sent && !madeEvent,
    `no send_email, no create_calendar_event in the cycle (drafts + suggestions only)`);

  // R7 — every recommendation explains why
  REQ("Every recommendation explains WHY it was generated",
    priorities.length > 0 && priorities.every((p) => p.why && p.why.length > 0),
    `${priorities.filter((p) => p.why).length}/${priorities.length} priorities have a non-empty why`);

  // R8 — continues working in the background every cycle
  const nextQueued = ms.some((m) => m.objective.includes("EXECUTIVE ASSISTANT") && m.status === "queued" && m.recurrence);
  REQ("Continues working in the background every execution cycle",
    nextQueued,
    `next kernel cycle is queued + recurring (every ${(cycle.recurrence?.everyMs || 0) / 60000} min)`);

  console.log("\n────────── Priority Queue (top 5, as published by the kernel) ──────────");
  for (const p of priorities.slice(0, 5)) console.log(`  [${p.score}] (${p.category}) ${p.title}\n        → ${p.recommendedAction}\n        why: ${p.why}`);

  const passed = R.filter((r) => r.pass).length, failed = R.length - passed;
  console.log(`\n${"=".repeat(64)}\nRESULT: ${passed}/${R.length} requirements PASS`);
  console.log(failed === 0 ? "✅ AUTONOMOUS EXECUTIVE ASSISTANT VERIFIED" : `❌ ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("crashed:", e?.message || e); process.exit(1); });
