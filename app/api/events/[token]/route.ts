import { NextRequest, NextResponse } from "next/server";
import { read } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inbound webhook trigger. POST /api/events/<token> with a JSON body → if a
 * webhook automation rule owns that token and is enabled, queue its mission with
 * the payload recorded as the triggering event. Provide an `id` in the body for
 * idempotency (the same id won't trigger twice).
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const rule = await read((db) => (db.automationRules || []).find((r) => r.type === "webhook" && r.enabled && r.webhookToken === params.token));
  if (!rule) return NextResponse.json({ error: "Unknown or disabled webhook." }, { status: 404 });

  const payload = await req.json().catch(() => ({}));
  const idemp = String(payload?.id || payload?.event_id || "");
  const key = "w:" + (idemp || Date.now().toString());
  if (idemp && (rule.seen || []).includes(key)) return NextResponse.json({ ok: true, deduped: true });

  const { createMission } = await import("@/lib/server/missionEngine");
  const { triggeredObjective, recordTrigger } = await import("@/lib/server/eventEngine");
  const event = `Webhook payload: ${JSON.stringify(payload).slice(0, 180)}`;
  const m = await createMission(triggeredObjective(rule, event), { trigger: { rule: rule.name, event } });
  await recordTrigger(rule.id, rule.name, "webhook", key, event, m.id);
  return NextResponse.json({ ok: true, missionId: m.id });
}
