"use client";

import { useEffect, useRef, useState } from "react";
import type { MissionView } from "@/lib/missionTypes";

/**
 * Client view of server-side missions.
 *
 * Missions execute on the backend and persist there, so the client just
 * watches: it polls for progress and results. Close the app, leave, come
 * back later — the missions kept running and the results are waiting.
 */
export function useServerMissions(pollMs = 2500): MissionView[] {
  const [missions, setMissions] = useState<MissionView[]>([]);
  const lastJson = useRef("");

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/missions", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const json = JSON.stringify(data.missions || []);
        if (alive && json !== lastJson.current) {
          lastJson.current = json;
          setMissions(data.missions || []);
        }
      } catch { /* offline — keep last known state */ }
    }
    poll();
    const t = setInterval(poll, pollMs);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollMs]);

  return missions;
}

export async function approveMission(id: string, approved: boolean) {
  try {
    await fetch(`/api/missions/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
  } catch { /* will retry on next user action */ }
}

/** Mark a completed mission as seen — durable + cross-device (not a local hide). */
export async function acknowledgeMission(id: string) {
  try {
    await fetch(`/api/missions/${id}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledged: true }),
    });
  } catch { /* will retry on next poll */ }
}
