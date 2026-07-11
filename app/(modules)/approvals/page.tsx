"use client";

import { useEffect, useState, useCallback } from "react";
import PageHeader from "@/components/PageHeader";
import { useBrand } from "@/components/BrandContext";
import { timeAgo } from "@/lib/store";

/**
 * Approval queue (Phase 2 #7). Evolution OS runs autonomously; only money,
 * contracts, external meetings, brand-setting changes, and missing-info items
 * surface here. Unifies stored approvals + mission-gated approvals. Minimal UI.
 */
const REASON_LABEL: Record<string, string> = {
  money: "💵 Money", contract: "📄 Contract", external_meeting: "🤝 External meeting",
  brand_setting: "🏷️ Brand setting", missing_info: "❓ Missing info", other: "• Review",
};

export default function ApprovalsPage() {
  const { activeBrand, isParentActive } = useBrand();
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(() => {
    const q = activeBrand && !isParentActive ? `?brandId=${activeBrand.id}` : "";
    fetch(`/api/approvals${q}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setItems(d.approvals || [])).catch(() => {});
  }, [activeBrand, isParentActive]);

  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);

  async function resolve(a: any, approved: boolean) {
    setItems((prev) => prev.filter((x) => x.id !== a.id));
    await fetch(`/api/approvals/${a.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved, kind: a.kind }) }).catch(() => {});
    load();
  }

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <PageHeader title="Approvals" subtitle="Evolution OS only asks when it must — money, contracts, external meetings, brand changes, or missing info" />
      {items.length === 0 ? (
        <div className="glass p-10 text-center text-slate-500">Nothing needs your approval. Evolution OS is running autonomously.</div>
      ) : (
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className="glass p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs px-2 py-0.5 rounded-full border border-white/10 text-slate-300">{REASON_LABEL[a.reason] || a.reason}</span>
                <span className="text-[11px] text-slate-600 ml-auto">{timeAgo(a.createdAt)}</span>
              </div>
              <div className="text-sm text-slate-100">{a.title}</div>
              {a.detail && <div className="text-xs text-slate-500 mt-0.5">{a.detail}</div>}
              <div className="flex gap-2 mt-3">
                <button onClick={() => resolve(a, true)} className="btn-primary text-sm px-3 py-1.5">Approve</button>
                <button onClick={() => resolve(a, false)} className="text-sm px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5">Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
