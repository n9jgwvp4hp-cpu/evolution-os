import { read, mutate, uid } from "@/lib/server/db";
import type { Approval, ApprovalReason } from "@/lib/types";
import { logActivity } from "@/lib/server/activity";

/**
 * Approval queue + policy (Phase 2 #7).
 *
 * Evolution OS runs autonomously by default. An action is gated for the user
 * ONLY when it spends money, sends a contract, books an external meeting, changes
 * important brand settings, or is missing required information. Everything else
 * executes automatically. `classifyApproval` encodes that policy in one place so
 * every producer (missions, tools, the planner) gates consistently.
 *
 * The queue unifies two sources: explicitly-raised approvals (money/contract/…)
 * stored here, and mission-gated approvals (missions in `needs_approval`) which
 * are merged in by the API layer.
 */

const MONEY = ["spend", "spend_money", "payment", "pay", "purchase", "charge", "invoice", "wire", "transfer"];
const CONTRACT = ["send_contract", "contract", "sign", "agreement", "esign", "proposal_contract"];
const EXTERNAL_MEETING = ["create_calendar_event", "book_meeting", "schedule_external", "send_invite"];
const BRAND_SETTING = ["update_brand", "change_brand_settings", "brand_setting", "update_brand_email", "update_brand_calendar"];

/** Decide whether a proposed action needs approval. Returns the gating reason, or
 *  null when the OS may execute it autonomously. */
export function classifyApproval(actionType: string, payload?: any): ApprovalReason | null {
  const t = String(actionType || "").toLowerCase();
  if (MONEY.some((k) => t.includes(k)) || (payload && Number(payload.amount) > 0)) return "money";
  if (CONTRACT.some((k) => t.includes(k))) return "contract";
  if (BRAND_SETTING.some((k) => t.includes(k))) return "brand_setting";
  // A calendar/meeting action is gated only when it involves an EXTERNAL attendee.
  if (EXTERNAL_MEETING.some((k) => t.includes(k))) {
    const attendees: string[] = payload?.attendees || payload?.guests || [];
    const external = Array.isArray(attendees) && attendees.length > 0;
    if (external || payload?.external) return "external_meeting";
    return null; // internal meeting → autonomous
  }
  if (payload?.missingInfo) return "missing_info";
  return null;
}

/** Raise an approval into the queue (idempotent-ish by title+brand while pending). */
export async function raiseApproval(input: {
  brandId?: string | null;
  reason: ApprovalReason;
  title: string;
  detail?: string;
  action?: { type: string; payload?: any };
  missionId?: string | null;
}): Promise<Approval> {
  let created!: Approval;
  await mutate((db) => {
    const dup = (db.approvals || []).find(
      (a) => a.status === "pending" && a.title === input.title && a.brandId === (input.brandId ?? null)
    );
    if (dup) { created = dup; return; }
    created = {
      id: uid(),
      brandId: input.brandId ?? null,
      reason: input.reason,
      title: String(input.title).slice(0, 240),
      detail: input.detail ? String(input.detail).slice(0, 600) : undefined,
      action: input.action,
      status: "pending",
      missionId: input.missionId ?? null,
      createdAt: Date.now(),
      resolvedAt: null,
    };
    db.approvals = [created, ...(db.approvals || [])].slice(0, 500);
  });
  await logActivity({ brandId: created.brandId, kind: "approval_needed", title: `Approval needed: ${created.title}`, detail: created.reason, refType: "approval", refId: created.id });
  return created;
}

export async function listStoredApprovals(opts: { brandId?: string; status?: Approval["status"] } = {}): Promise<Approval[]> {
  return read((db) => {
    let items = db.approvals || [];
    if (opts.brandId) items = items.filter((a) => a.brandId === opts.brandId);
    if (opts.status) items = items.filter((a) => a.status === opts.status);
    return items;
  });
}

export async function resolveApproval(id: string, approved: boolean): Promise<Approval | undefined> {
  let out: Approval | undefined;
  await mutate((db) => {
    const a = (db.approvals || []).find((x) => x.id === id);
    if (!a || a.status !== "pending") { out = a; return; }
    a.status = approved ? "approved" : "declined";
    a.resolvedAt = Date.now();
    out = a;
  });
  if (out) await logActivity({ brandId: out.brandId, kind: "pipeline_update", title: `${approved ? "Approved" : "Declined"}: ${out.title}`, refType: "approval", refId: out.id });
  return out;
}
