"use client";

import { useState } from "react";
import { useBrand } from "@/components/BrandContext";

/**
 * Brand switcher — the header control that sets the portfolio-wide active brand.
 * Functional and intentionally minimal (no final UI polish yet). The parent
 * holding company (UW Equity) is pinned to the top and marked as the portfolio
 * roll-up; subsidiaries follow.
 */
export default function BrandSwitcher() {
  const { brands, activeBrand, activeBrandId, setActiveBrandId, loaded } = useBrand();
  const [open, setOpen] = useState(false);
  if (!loaded || brands.length === 0) return null;

  // Order: holding company → business brands → Personal (kept visually separate).
  const rank = (b: any) => (b.kind === "holding" ? 0 : b.kind === "personal" ? 2 : 1);
  const ordered = [...brands].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const dot = activeBrand?.colors?.primary || "#6366f1";
  const typeLabel = (k?: string) => (k === "holding" ? "Portfolio" : k === "personal" ? "Personal" : "Brand");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-200 border border-white/10 hover:bg-white/10 transition max-w-[52vw]"
        title="Switch brand"
      >
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: dot }} />
        <span className="truncate font-medium">{activeBrand?.name || "Select brand"}</span>
        {activeBrand && <span className="text-[10px] text-slate-500 uppercase tracking-wide">{typeLabel(activeBrand.kind)}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" className="text-slate-500 shrink-0"><path fill="currentColor" d="m7 10l5 5l5-5z" /></svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 right-0 w-64 rounded-xl border border-white/10 bg-surface/95 backdrop-blur-2xl p-1.5 shadow-xl">
            {ordered.map((b, i) => {
              const active = b.id === activeBrandId;
              // Divider before the Personal account to reinforce the separation.
              const showDivider = b.kind === "personal" && ordered[i - 1]?.kind !== "personal";
              return (
                <div key={b.id}>
                  {showDivider && <div className="my-1 border-t border-white/10" />}
                  <button
                    onClick={() => { setActiveBrandId(b.id); setOpen(false); }}
                    className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${active ? "bg-white/10" : "hover:bg-white/5"}`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: b.colors?.primary || "#6366f1" }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-slate-100 truncate">{b.name}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {b.kind === "holding" ? "Parent · portfolio roll-up" : b.kind === "personal" ? "Personal · separate from business" : (b.services?.[0] || "Business brand")}
                      </span>
                    </span>
                    {active && <span className="text-accent text-xs">●</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
