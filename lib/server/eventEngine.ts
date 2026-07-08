import { read, mutate } from "@/lib/server/db";
import { fetchWithTimeout } from "@/lib/server/http";
import type { AutomationRule } from "@/lib/types";

/**
 * Event Engine — makes Evolution OS reactive.
 *
 * On each throttled tick it evaluates enabled automation rules against the
 * user's real integrations (Gmail, Calendar) and time (scheduled events), and
 * queues a mission when a rule fires. Webhook rules fire via /api/events/[token].
 *
 * Loop / spend safety:
 *  - dedup: every fire has a stable key (email id, calendar occurrence, schedule
 *    day/bucket); a key is triggered at most once (kept in rule.seen).
 *  - hard caps per run (GLOBAL_CAP) and per rule (PER_RULE_CAP).
 *  - triggered missions do NOT take outward actions (no email send / event
 *    create), so they can't generate new events that re-trigger a rule.
 */

const GLOBAL_CAP = 10;   // max missions queued per engine run
const PER_RULE_CAP = 5;  // max per rule per run
const SEEN_MAX = 200;    // bounded dedup memory per rule

type Ctx = { now: number; emails: { id: string; from: string; subject: string }[]; events: { id: string; summary: string; start: string; location: string }[] };

async function googleToken(): Promise<string | null> {
  try { const { getServerAccessToken } = await import("@/lib/server/google"); return await getServerAccessToken(); }
  catch { return null; }
}

async function fetchRecentEmails(token: string): Promise<Ctx["emails"]> {
  const auth = { Authorization: `Bearer ${token}` };
  const list = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${encodeURIComponent("newer_than:2d")}`, { headers: auth }, 8000);
  if (!list.ok) return [];
  const refs = (await list.json()).messages || [];
  const out: Ctx["emails"] = [];
  for (const r of refs.slice(0, 20)) {
    const g = await fetchWithTimeout(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${r.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, { headers: auth }, 6000);
    if (!g.ok) continue;
    const hdr: Record<string, string> = {};
    for (const h of (await g.json()).payload?.headers || []) hdr[h.name.toLowerCase()] = h.value;
    out.push({ id: r.id, from: hdr.from || "", subject: hdr.subject || "" });
  }
  return out;
}

async function fetchUpcomingEvents(token: string): Promise<Ctx["events"]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
  const res = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=20`, { headers: { Authorization: `Bearer ${token}` } }, 8000);
  if (!res.ok) return [];
  return ((await res.json()).items || []).map((e: any) => ({ id: e.id, summary: e.summary || "(untitled)", start: e.start?.dateTime || e.start?.date, location: e.location || "" }));
}

/** Build the safe objective for a triggered mission (no outward actions). */
export function triggeredObjective(rule: AutomationRule, event: string): string {
  return (
    `${rule.objective}\n\n` +
    `— Triggered automatically by rule "${rule.name}". Triggering event: ${event}\n` +
    `Do only safe preparatory work (read, research, summarize, draft, create notes/tasks). ` +
    `Do NOT send email or create/modify calendar events.`
  );
}

function evaluate(rule: AutomationRule, ctx: Ctx): { key: string; event: string; objective: string }[] {
  const hits: { key: string; event: string; objective: string }[] = [];
  if (rule.type === "email") {
    if (!rule.from && !rule.subjectContains) return hits; // require a condition
    for (const m of ctx.emails) {
      const fromOk = !rule.from || m.from.toLowerCase().includes(rule.from.toLowerCase());
      const subjOk = !rule.subjectContains || m.subject.toLowerCase().includes(rule.subjectContains.toLowerCase());
      if (fromOk && subjOk) {
        const event = `Email from ${m.from} — “${m.subject}”`;
        hits.push({ key: "e:" + m.id, event, objective: triggeredObjective(rule, event) });
      }
    }
  } else if (rule.type === "calendar") {
    const lead = (rule.leadMinutes || 60) * 60_000;
    for (const e of ctx.events) {
      const start = Date.parse(e.start);
      if (isNaN(start)) continue;
      const delta = start - ctx.now;
      if (delta > 0 && delta <= lead) {
        const event = `Upcoming meeting “${e.summary}” at ${new Date(start).toISOString()}${e.location ? ` (${e.location})` : ""}`;
        hits.push({ key: "c:" + e.id + "@" + start, event, objective: triggeredObjective(rule, event) });
      }
    }
  } else if (rule.type === "schedule") {
    if (rule.everyMinutes && rule.everyMinutes > 0) {
      const bucket = Math.floor(ctx.now / (rule.everyMinutes * 60_000));
      const event = `Scheduled cadence (every ${rule.everyMinutes} min)`;
      hits.push({ key: "s:" + bucket, event, objective: triggeredObjective(rule, event) });
    } else if (rule.atTime && /^\d{2}:\d{2}$/.test(rule.atTime)) {
      const [hh, mm] = rule.atTime.split(":").map(Number);
      const d = new Date(ctx.now);
      const fire = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm);
      if (ctx.now >= fire) {
        const dayKey = new Date(ctx.now).toISOString().slice(0, 10);
        const event = `Daily schedule at ${rule.atTime} UTC`;
        hits.push({ key: "s:" + dayKey, event, objective: triggeredObjective(rule, event) });
      }
    }
  }
  return hits;
}

/** Persist a fire: mark the key seen, bump counts, append to the event log. */
export async function recordTrigger(ruleId: string, ruleName: string, type: string, key: string, event: string, missionId: string) {
  await mutate((db) => {
    const r = db.automationRules.find((x) => x.id === ruleId);
    if (r) { r.seen = [...(r.seen || []), key].slice(-SEEN_MAX); r.triggerCount = (r.triggerCount || 0) + 1; r.lastTriggeredAt = Date.now(); }
    db.eventLog = [{ ts: Date.now(), ruleId, ruleName, type, event, missionId }, ...(db.eventLog || [])].slice(0, 60);
  });
  // eslint-disable-next-line no-console
  console.log(`[Evolution OS][events] rule="${ruleName}" fired → mission ${missionId} (${event.slice(0, 80)})`);
}

/** Evaluate all watch-based rules and queue any newly-triggered missions. */
export async function runEventEngine() {
  const rules = (await read((db) => db.automationRules || [])).filter((r) => r.enabled && r.type !== "webhook");
  if (!rules.length) return;
  const now = Date.now();
  const needEmail = rules.some((r) => r.type === "email");
  const needCal = rules.some((r) => r.type === "calendar");
  let emails: Ctx["emails"] = [], events: Ctx["events"] = [];
  if (needEmail || needCal) {
    const token = await googleToken();
    if (token) {
      if (needEmail) emails = await fetchRecentEmails(token).catch(() => []);
      if (needCal) events = await fetchUpcomingEvents(token).catch(() => []);
    }
  }
  const { createMission } = await import("@/lib/server/missionEngine");
  let created = 0;
  for (const rule of rules) {
    if (created >= GLOBAL_CAP) break;
    let perRule = 0;
    for (const hit of evaluate(rule, { now, emails, events })) {
      if (created >= GLOBAL_CAP || perRule >= PER_RULE_CAP) break;
      const already = await read((db) => (db.automationRules.find((r) => r.id === rule.id)?.seen || []).includes(hit.key));
      if (already) continue; // dedup — never trigger the same event twice
      const m = await createMission(hit.objective, { trigger: { rule: rule.name, event: hit.event } });
      await recordTrigger(rule.id, rule.name, rule.type, hit.key, hit.event, m.id);
      created++; perRule++;
    }
  }
}
