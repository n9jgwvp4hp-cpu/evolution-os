"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BrainKind } from "@/lib/types";

/**
 * Server-backed collection hook — a drop-in replacement for useLocalStorage.
 *
 * Returns `[items, setItems, loaded]` exactly like the old local hook, but the
 * data lives in the shared server brain (/api/data/[kind]). So a module view, a
 * conversation action, and a mission all read and write the same state.
 *
 * On first use it migrates any legacy localStorage data up to the server once,
 * so nothing the user created before the backend existed is lost.
 */
export function useCollection<T>(kind: BrainKind, initial: T[]) {
  const [value, setValue] = useState<T[]>(initial);
  const [loaded, setLoaded] = useState(false);
  const dirty = useRef(false);

  // Load from the server (migrating legacy local data once if the server is empty).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/data/${kind}`, { cache: "no-store" });
        const data = await res.json();
        let items: T[] = Array.isArray(data.items) ? data.items : [];

        const migrationKey = `evo.migrated.${kind}`;
        const legacyKey = `evo.${kind}`;
        if (items.length === 0 && !localStorage.getItem(migrationKey)) {
          try {
            const legacyRaw = localStorage.getItem(legacyKey);
            const legacy: T[] = legacyRaw ? JSON.parse(legacyRaw) : [];
            if (Array.isArray(legacy) && legacy.length) {
              await fetch(`/api/data/${kind}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ items: legacy }),
              });
              items = legacy;
            }
          } catch { /* ignore bad legacy data */ }
          localStorage.setItem(migrationKey, "1");
        }

        if (alive) setValue(items);
      } catch {
        /* offline — keep initial */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [kind]);

  // Persist whole-collection changes back to the brain (after initial load).
  useEffect(() => {
    if (!loaded || !dirty.current) return;
    const items = value;
    const t = setTimeout(() => {
      fetch(`/api/data/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }).catch(() => { /* will save again on next change */ });
    }, 150);
    return () => clearTimeout(t);
  }, [value, loaded, kind]);

  // Wrap the setter so we only persist user-driven changes, not the initial load.
  const set = useCallback((next: React.SetStateAction<T[]>) => {
    dirty.current = true;
    setValue(next);
  }, []);

  return [value, set, loaded] as const;
}
