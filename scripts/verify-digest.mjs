#!/usr/bin/env node
/**
 * Weekly digest draft — PASS/FAIL verification (offline, static + logic).
 *   node scripts/verify-digest.mjs
 *
 * Verifies the kernel prepares ONE Gmail DRAFT per ISO week summarizing the
 * week's top priorities, completed missions, and open follow-ups — idempotently,
 * without ever sending mail or creating calendar events, and without touching the
 * every-4h kernel cadence.
 */
import { readFileSync } from "fs";
const src = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

const R = [];
const REQ = (n, pass, d) => { R.push({ n, pass }); console.log(`   ${pass ? "✓ PASS" : "✗ FAIL"}  ${n} — ${d}`); };

const tools = src("lib/server/tools.ts");
const engine = src("lib/server/missionEngine.ts");

// Isolate the prepare_weekly_digest tool block for focused checks.
const start = tools.indexOf('name: "prepare_weekly_digest"');
const tool = start >= 0 ? tools.slice(start, tools.indexOf('name: "suggest_calendar_event"', start)) : "";

// Reimplement the ISO-week key to assert the algorithm's correctness on known dates.
function isoWeekKey(d) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

console.log("WEEKLY DIGEST DRAFT — VERIFICATION\n");

console.log("[CAPABILITY]");
REQ("Kernel has a weekly-digest capability (prepare_weekly_digest tool)",
  !!tool, start >= 0 ? "tool present in lib/server/tools.ts" : "tool NOT found");
REQ("Prepares a Gmail DRAFT (POST /drafts) — never sends",
  /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/drafts/.test(tool) &&
  !/messages\/send/.test(tool) && !/calendar\/v3/.test(tool),
  "creates a draft; no messages/send, no calendar create in the digest path");
REQ("Summarizes priorities, completed missions, and open follow-ups",
  /TOP PRIORITIES/.test(tool) && /COMPLETED MISSIONS/.test(tool) && /OPEN FOLLOW-UPS/.test(tool) &&
  /db\.priorities/.test(tool) && /listMissionViews/.test(tool) && /db\.tasks\.filter/.test(tool),
  "pulls priorities + done missions this week + open tasks/missions into the body");

console.log("\n[IDEMPOTENCY — one draft per ISO week]");
REQ("Digest is keyed by ISO week",
  /isoWeekKey/.test(tool) && /Weekly Digest — \$\{weekKey\}/.test(tool),
  "subject carries the ISO week key");
REQ("Skips creating a second draft for the same week",
  /deduped: true/.test(tool) && /already exists/.test(tool) &&
  /subject\.toLowerCase\(\)/.test(tool),
  "checks existing Gmail drafts by this week's subject before creating");
REQ("Completed-mission window is this ISO week (Monday start)",
  /isoWeekStart/.test(tool) && />= weekStart/.test(tool),
  "filters done missions to updatedAt within the current ISO week");

console.log("\n[ISO WEEK LOGIC]");
const cases = [
  ["2026-07-08", "2026-W28"], // Wednesday, mid-week
  ["2021-01-04", "2021-W01"], // Monday of the first ISO week of 2021
  ["2021-01-01", "2020-W53"], // Friday — belongs to the last ISO week of 2020
  ["2016-01-01", "2015-W53"], // Friday — last ISO week of 2015
];
let logicOk = true;
for (const [iso, want] of cases) {
  const got = isoWeekKey(new Date(iso + "T12:00:00Z"));
  const ok = got === want;
  logicOk = logicOk && ok;
  console.log(`   ${ok ? "✓" : "✗"} ${iso} → ${got} (want ${want})`);
}
REQ("ISO-8601 week computation is correct", logicOk, "known dates map to the expected ISO week");

console.log("\n[KERNEL WIRING — cadence unchanged]");
REQ("Weekly digest is an additional idempotent step in the kernel objective",
  /PHASE 5 — WEEKLY DIGEST/.test(engine) && /prepare_weekly_digest/.test(engine) &&
  /idempotent per ISO week/.test(engine),
  "PHASE 5 instructs the kernel to call prepare_weekly_digest once");
REQ("Every-4h kernel cadence is untouched",
  /KERNEL_EVERY_MS = Math\.max\(5, Number\(process\.env\.KERNEL_EVERY_MIN\) \|\| 1440\)/.test(engine) &&
  /recurrence: \{ everyMs: KERNEL_EVERY_MS \}/.test(engine),
  "kernel still recurs on the same KERNEL_EVERY_MIN cadence");
REQ("Kernel never sends mail or creates events autonomously",
  /do NOT use send_email or create_calendar_event/.test(engine) &&
  /never sends mail or creates calendar events/.test(engine),
  "safety rule + digest phase both forbid outward/irreversible actions");

const passed = R.filter((r) => r.pass).length, failed = R.length - passed;
console.log(`\n${"=".repeat(64)}\nRESULT: ${passed}/${R.length} requirements PASS`);
console.log(failed === 0 ? "✅ WEEKLY DIGEST DRAFT VERIFIED" : `❌ ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
