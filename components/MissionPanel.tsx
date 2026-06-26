"use client";

import { useState } from "react";
import type { MissionView as Mission } from "@/lib/missionTypes";

/**
 * Live view of background missions, shown inline at the top of the
 * conversation. The user sees objectives and progress — never tools or steps
 * unless they choose to expand. Approvals surface right here.
 */
export default function MissionPanel({
  missions,
  onApprove,
  onDismiss,
}: {
  missions: Mission[];
  onApprove: (id: string, ok: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  if (!missions.length) return null;
  return (
    <div className="space-y-2 mb-3">
      {missions.map((m) => (
        <MissionCard key={m.id} m={m} onApprove={onApprove} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function MissionCard({
  m,
  onApprove,
  onDismiss,
}: {
  m: Mission;
  onApprove: (id: string, ok: boolean) => void;
  onDismiss: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const running = m.status === "running";
  const lastStep = m.steps[m.steps.length - 1];

  const tone =
    m.status === "failed"
      ? "border-pink-500/40"
      : m.status === "done"
      ? "border-emerald-500/40"
      : m.status === "needs_approval"
      ? "border-amber-500/40"
      : "border-accent/40";

  return (
    <div className={`rounded-2xl border ${tone} bg-white/[0.04] p-3.5`}>
      <div className="flex items-start gap-2">
        <StatusDot status={m.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-slate-500">Mission</span>
            <span className="text-[10px]">{label(m)}</span>
          </div>
          <p className="text-sm text-slate-100 leading-snug mt-0.5">{m.objective}</p>

          {/* latest progress line */}
          {lastStep && m.status !== "done" && (
            <p className="text-xs text-slate-400 mt-1.5 truncate">
              {running && "… "}{lastStep.text}
            </p>
          )}

          {/* completion result */}
          {m.status === "done" && m.result && (
            <p className="text-xs text-emerald-200/90 mt-1.5 whitespace-pre-wrap">{m.result}</p>
          )}
          {m.status === "failed" && m.result && (
            <p className="text-xs text-pink-300 mt-1.5">{m.result}</p>
          )}

          {/* approval */}
          {m.status === "needs_approval" && m.pending[0] && (
            <div className="mt-2">
              <p className="text-xs text-amber-200">🔐 {m.pending[0].summary}</p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => onApprove(m.id, true)} className="btn-primary !py-1 text-xs flex-1">
                  Approve
                </button>
                <button onClick={() => onApprove(m.id, false)} className="btn-ghost !py-1 text-xs flex-1">
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* controls */}
          <div className="flex items-center gap-3 mt-2 text-[11px]">
            {m.steps.length > 1 && (
              <button onClick={() => setOpen((v) => !v)} className="text-slate-500 hover:text-slate-300">
                {open ? "Hide steps" : `${m.steps.length} steps`}
              </button>
            )}
            {(m.status === "done" || m.status === "failed") && (
              <button onClick={() => onDismiss(m.id)} className="text-slate-500 hover:text-slate-300 ml-auto">
                Dismiss
              </button>
            )}
          </div>

          {/* expanded log */}
          {open && (
            <div className="mt-2 space-y-1 border-t border-white/5 pt-2">
              {m.steps.map((s) => (
                <div key={s.id} className="text-[11px] text-slate-400 flex gap-2">
                  <span className="text-slate-600">{stepIcon(s.kind)}</span>
                  <span className="flex-1">
                    {s.text}
                    {s.detail && <span className="text-pink-300/80"> · {s.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: Mission["status"] }) {
  if (status === "running")
    return <span className="mt-1 w-2.5 h-2.5 rounded-full bg-accent animate-pulseGlow shrink-0" />;
  if (status === "needs_approval")
    return <span className="mt-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulseGlow shrink-0" />;
  if (status === "done")
    return <span className="mt-1 w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />;
  if (status === "queued")
    return <span className="mt-1 w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />;
  return <span className="mt-1 w-2.5 h-2.5 rounded-full bg-pink-400 shrink-0" />;
}

function label(m: Mission) {
  const status = m.status;
  if (status === "running") return "🛰️ working…";
  if (status === "needs_approval") return "⏸️ needs you";
  if (status === "done") return "✓ complete";
  if (status === "failed") return "✕ failed";
  // queued
  if (m.scheduledFor && m.scheduledFor > Date.now()) {
    return `🕑 scheduled · ${new Date(m.scheduledFor).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  }
  return "• queued";
}
function stepIcon(kind: string) {
  return kind === "action" ? "→" : kind === "result" ? "✓" : kind === "error" ? "✕" : "·";
}
