import { NextRequest, NextResponse } from "next/server";
import { read, mutate, uid } from "@/lib/server/db";
import type { AutomationRule } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — list all automation rules (with runtime counts). */
export async function GET() {
  const rules = await read((db) => db.automationRules || []);
  const eventLog = await read((db) => db.eventLog || []);
  return NextResponse.json({ ok: true, rules, eventLog });
}

/** POST — create an automation rule. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b || !b.name || !b.type || !b.objective) {
    return NextResponse.json({ error: "name, type, and objective are required." }, { status: 400 });
  }
  const type = ["email", "calendar", "schedule", "webhook"].includes(b.type) ? b.type : "schedule";
  const rule: AutomationRule = {
    id: uid(),
    name: String(b.name).slice(0, 80),
    enabled: b.enabled !== false,
    type,
    from: b.from ? String(b.from).slice(0, 160) : undefined,
    subjectContains: b.subjectContains ? String(b.subjectContains).slice(0, 160) : undefined,
    leadMinutes: b.leadMinutes ? Math.max(1, Number(b.leadMinutes)) : undefined,
    atTime: /^\d{2}:\d{2}$/.test(b.atTime || "") ? b.atTime : undefined,
    everyMinutes: b.everyMinutes ? Math.max(5, Number(b.everyMinutes)) : undefined,
    webhookToken: type === "webhook" ? uid() : undefined,
    objective: String(b.objective).slice(0, 2000),
    seen: [],
    triggerCount: 0,
    lastTriggeredAt: null,
    createdAt: Date.now(),
  };
  await mutate((db) => { db.automationRules = [rule, ...(db.automationRules || [])]; });
  return NextResponse.json({ ok: true, rule });
}
