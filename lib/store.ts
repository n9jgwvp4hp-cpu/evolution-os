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

// ---- Shared data types used across the dashboard ----
export type Project = {
  id: string;
  name: string;
  description: string;
  status: "planning" | "active" | "done";
  createdAt: number;
};

export type Note = {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
};

export type Task = {
  id: string;
  title: string;
  done: boolean;
  priority: "low" | "medium" | "high";
  createdAt: number;
};

export type StoredFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string; // base64 content, stored locally
  createdAt: number;
};
