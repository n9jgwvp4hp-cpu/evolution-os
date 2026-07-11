import { NextRequest, NextResponse } from "next/server";
import { listStoredApprovals, raiseApproval, classifyApproval } from "@/lib/server/approvals";
import { listMissionViews } from "@/lib/server/missionStore";
import type { ApprovalReason } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/approvals — apply the autonomy policy to a proposed action and raise
 * an approval ONLY if it is gated (money / contract / external meeting / brand
 * setting / missing info). Body: { actionType, payload?, title, detail?, brandId?,
 * reason? }. If `reason` is given it is raised directly; otherwise the action is
 * classified and autonomous actions return { gated:false } without queueing.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  let reason: ApprovalReason | null = b.reason || null;
  if (!reason && b.actionType) reason = classifyApproval(String(b.actionType), b.payload);
  if (!reason) return NextResponse.json({ ok: true, gated: false, message: "autonomous — no approval required" });
  const approval = await raiseApproval({
    brandId: b.brandId ?? null, reason,
    title: b.title || `Approve: ${b.actionType || "action"}`,
    detail: b.detail, action: b.actionType ? { type: b.actionType, payload: b.payload } : undefined,
  });
  return NextResponse.json({ ok: true, gated: true, approval });
}

/**
 * GET the unified approval queue: explicitly-raised approvals (money / contracts /
 * external meetings / brand settings / missing info) plus mission-gated approvals
 * (missions in needs_approval), in one inbox. ?brandId=… scopes it.
 */
export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId") || undefined;

  const stored = (await listStoredApprovals({ brandId, status: "pending" })).map((a) => ({
    id: a.id, kind: "stored" as const, reason: a.reason, brandId: a.brandId,
    title: a.title, detail: a.detail, missionId: a.missionId, createdAt: a.createdAt,
  }));

  const missions = (await listMissionViews())
    .filter((m) => m.status === "needs_approval" && (!brandId || m.brandId === brandId))
    // A mission approval already surfaced as a stored approval is not duplicated.
    .filter((m) => !stored.some((s) => s.missionId === m.id))
    .map((m) => {
      const pend = (m as any).pending?.[0];
      return {
        id: m.id, kind: "mission" as const, reason: "other" as const, brandId: m.brandId ?? null,
        title: pend?.summary || `Approve: ${String(m.objective).slice(0, 80)}`,
        detail: String(m.objective).slice(0, 160), missionId: m.id, createdAt: m.updatedAt,
      };
    });

  const items = [...stored, ...missions].sort((a, b) => b.createdAt - a.createdAt);
  return NextResponse.json({ ok: true, approvals: items, count: items.length });
}
