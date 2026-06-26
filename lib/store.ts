"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A tiny persistence layer built on the browser's localStorage.
 * Everything you create (projects, notes, tasks, files) is saved
 * right inside your browser — no database or server setup required.
 */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  // Load once on mount (client-side only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore corrupt data */
    }
    setLoaded(true);
  }, [key]);

  // Save whenever the value changes (after the initial load).
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full or unavailable */
    }
  }, [key, value, loaded]);

  return [value, setValue, loaded] as const;
}

/** Generate a unique id without any external dependency. */
export function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

/** Human-friendly date formatter. */
export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Entity types now live in lib/types.ts (shared by client + server brain).
export type {
  Project,
  Note,
  Task,
  StoredFile,
  LeadStatus,
  Contact,
  DealStage,
  Deal,
  Memory,
  BrainKind,
} from "@/lib/types";

/** Format a number as USD with no cents. */
export function formatMoney(n: number): string {
  if (!n) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Short relative time, e.g. "3d ago". */
export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
