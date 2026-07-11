"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import { useBrand } from "@/components/BrandContext";
import { timeAgo } from "@/lib/store";
import type { Activity } from "@/lib/types";

/**
 * Global activity feed (Phase 2 #6) — "what did Evolution OS complete while I was
 * away?". Scopes to the active brand (parent = portfolio-wide). Minimal UI.
 */
const ICON: Record<string, string> = {
  mission_created: "🚀", mission_completed: "✅", mission_failed: "⛔",
  email_sent: "✉️", email_drafted: "📝", meeting_scheduled: "📅",
  new_lead: "✨", revenue_change: "💰", pipeline_update: "📊",
  approval_needed: "🔔", brand_change: "🏷️", error: "⚠️", blocker: "🧱",
};

export default function ActivityPage() {
  const { activeBrand, isParentActive } = useBrand();
  const [items, setItems] = useState<Activity[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      const q = activeBrand && !isParentActive ? `?brandId=${activeBrand.id}` : "";
      fetch(`/api/activity${q}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (alive) setItems(d.activity || []); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [activeBrand, isParentActive]);

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <PageHeader title="Activity" subtitle={`What Evolution OS has done${activeBrand && !isParentActive ? ` for ${activeBrand.name}` : " across the portfolio"}`} />
      {items.length === 0 ? (
        <div className="glass p-10 text-center text-slate-500">No activity yet.</div>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <div key={a.id} className="glass p-3 flex items-start gap-3">
              <span className="text-lg leading-none mt-0.5">{ICON[a.kind] || "•"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-200">{a.title}</div>
                {a.detail && <div className="text-xs text-slate-500 truncate">{a.detail}</div>}
              </div>
              <span className="text-[11px] text-slate-600 shrink-0">{timeAgo(a.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
