import { read, mutate, uid } from "@/lib/server/db";
import type { Activity, ActivityKind } from "@/lib/types";

/**
 * Global activity feed (Phase 2 #6) — the append-only, bounded log that answers
 * "what did Evolution OS complete while I was away?". Every operational event
 * (missions, emails, meetings, leads, revenue, pipeline moves, errors, blockers)
 * flows through logActivity so the feed is one coherent timeline across brands.
 */
const CAP = 800;

export async function logActivity(a: {
  brandId?: string | null;
  kind: ActivityKind;
  title: string;
  detail?: string;
  refType?: string;
  refId?: string;
}): Promise<Activity> {
  const item: Activity = {
    id: uid(),
    brandId: a.brandId ?? null,
    kind: a.kind,
    title: String(a.title).slice(0, 240),
    detail: a.detail ? String(a.detail).slice(0, 600) : undefined,
    refType: a.refType,
    refId: a.refId,
    createdAt: Date.now(),
  };
  await mutate((db) => { db.activityLog = [item, ...(db.activityLog || [])].slice(0, CAP); });
  return item;
}

export async function listActivity(opts: { brandId?: string; kinds?: ActivityKind[]; limit?: number; since?: number } = {}): Promise<Activity[]> {
  return read((db) => {
    let items = db.activityLog || [];
    if (opts.brandId) items = items.filter((x) => x.brandId === opts.brandId);
    if (opts.kinds?.length) items = items.filter((x) => opts.kinds!.includes(x.kind));
    if (opts.since) items = items.filter((x) => x.createdAt >= opts.since!);
    return items.slice(0, opts.limit ?? 100);
  });
}
