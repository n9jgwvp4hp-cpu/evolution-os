"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";
import type { Brand } from "@/lib/types";

/**
 * Brand context — the client-side source of truth for the multi-brand portfolio
 * and the currently-focused brand. Every brand-aware view (CRM, pipeline,
 * projects, onboarding) reads the active brand from here; the switcher writes it.
 *
 * The active brand is persisted server-side (/api/brands/active) so it is stable
 * across devices, and mirrored to localStorage for an instant first paint.
 */
type BrandCtx = {
  brands: Brand[];
  loaded: boolean;
  activeBrandId: string | null;
  activeBrand: Brand | null;
  parentBrand: Brand | null;
  isParentActive: boolean;
  setActiveBrandId: (id: string | null) => void;
  reload: () => Promise<void>;
};

const Ctx = createContext<BrandCtx | null>(null);
const LS_KEY = "evo.activeBrandId";

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [activeBrandId, setActive] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [bRes, aRes] = await Promise.all([
        fetch("/api/brands", { cache: "no-store" }),
        fetch("/api/brands/active", { cache: "no-store" }),
      ]);
      const bJson = await bRes.json();
      const aJson = await aRes.json();
      const list: Brand[] = bJson.brands || [];
      setBrands(list);
      const serverActive = aJson.activeBrandId || (list.find((b) => b.isParent) || list[0])?.id || null;
      setActive(serverActive);
      if (serverActive) try { localStorage.setItem(LS_KEY, serverActive); } catch {}
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    try { const cached = localStorage.getItem(LS_KEY); if (cached) setActive(cached); } catch {}
    reload();
  }, [reload]);

  const setActiveBrandId = useCallback((id: string | null) => {
    setActive(id);
    if (id) try { localStorage.setItem(LS_KEY, id); } catch {}
    fetch("/api/brands/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brandId: id }),
    }).catch(() => {});
  }, []);

  const value = useMemo<BrandCtx>(() => {
    const activeBrand = brands.find((b) => b.id === activeBrandId) || null;
    const parentBrand = brands.find((b) => b.isParent) || null;
    return {
      brands, loaded, activeBrandId, activeBrand, parentBrand,
      isParentActive: !!activeBrand?.isParent,
      setActiveBrandId, reload,
    };
  }, [brands, loaded, activeBrandId, setActiveBrandId, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBrand(): BrandCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBrand must be used within BrandProvider");
  return ctx;
}
