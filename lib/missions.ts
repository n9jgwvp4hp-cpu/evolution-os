"use client";

import { useSyncExternalStore } from "react";
import { uid } from "@/lib/store";

/**
 * Mission Mode.
 *
 * A Mission is a long-running OBJECTIVE that executes in the background while
 * the user keeps talking. The user states a goal; Evolution plans, works step
 * by step, reports progress, pauses for approval when needed, and notifies on
 * completion. The user never thinks about steps, tools, or agents — only the
 * objective and the result.
 *
 * This store is the single source of truth for missions. It persists to
 * localStorage and notifies React via useSyncExternalStore.
 */

export type MissionStatus = "running" | "needs_approval" | "done" | "failed";
export type MissionStepKind = "plan" | "progress" | "action" | "result" | "error";

export type MissionStep = {
  id: string;
  ts: number;
  kind: MissionStepKind;
  text: string;
  detail?: string;
};

export type MissionApiMsg = {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
};

export type PendingCall = { call: any; summary: string };

export type Mission = {
  id: string;
  objective: string;
  status: MissionStatus;
  steps: MissionStep[];
  api: MissionApiMsg[]; // the running model conversation (enables resume)
  pending: PendingCall[]; // tool calls in the current turn awaiting approval
  result?: string;
  createdAt: number;
  updatedAt: number;
};

const KEY = "evo.missions";
const EMPTY: Mission[] = [];
const listeners = new Set<() => void>();

function load(): Mission[] {
  if (typeof window === "undefined") return EMPTY;
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "[]");
  } catch {
    return EMPTY;
  }
}

let missions: Mission[] = load();

function commit(next: Mission[]) {
  missions = next;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(KEY, JSON.stringify(missions)); } catch { /* ignore */ }
  }
  listeners.forEach((l) => l());
}

/* ---- React binding ---- */
export function useMissions(): Mission[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => missions,
    () => EMPTY
  );
}

/* ---- imperative API (used by the runner + UI) ---- */
export function getMission(id: string) {
  return missions.find((m) => m.id === id);
}

export function createMission(objective: string): Mission {
  const m: Mission = {
    id: uid(),
    objective,
    status: "running",
    steps: [{ id: uid(), ts: Date.now(), kind: "plan", text: "Mission accepted" }],
    api: [{ role: "user", content: objective }],
    pending: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  commit([m, ...missions]);
  return m;
}

export function updateMission(id: string, patch: Partial<Mission>) {
  commit(missions.map((m) => (m.id === id ? { ...m, ...patch, updatedAt: Date.now() } : m)));
}

export function addStep(id: string, step: Omit<MissionStep, "id" | "ts">) {
  commit(
    missions.map((m) =>
      m.id === id
        ? { ...m, steps: [...m.steps, { ...step, id: uid(), ts: Date.now() }], updatedAt: Date.now() }
        : m
    )
  );
}

export function pushApi(id: string, msg: MissionApiMsg) {
  commit(
    missions.map((m) => (m.id === id ? { ...m, api: [...m.api, msg], updatedAt: Date.now() } : m))
  );
}

export function removeMission(id: string) {
  commit(missions.filter((m) => m.id !== id));
}
