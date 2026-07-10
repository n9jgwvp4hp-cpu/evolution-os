/**
 * Shared mission types — safe to import from both server and client.
 * No browser or Node APIs here.
 *
 * A Mission is the unit of persistent execution in Evolution OS. The user
 * states an objective; the server plans, executes, monitors, and reports —
 * independently of whether the app is open.
 */

export type MissionStatus =
  | "queued" // accepted, waiting for the worker
  | "running" // actively executing on the server
  | "needs_approval" // paused for a user decision
  | "paused" // deprioritized by the Objective Planner — not runnable until resumed
  | "done"
  | "failed";

export type MissionStepKind = "plan" | "progress" | "action" | "result" | "error" | "status";

/** Human-facing status labels used in the mission log (see logStatus). */
export const STATUS_LABEL = {
  queued: "Queued",
  running: "Running",
  needs_approval: "Waiting",
  paused: "Paused",
  done: "Completed",
  failed: "Failed",
} as const;

export type MissionStep = {
  id: string;
  ts: number;
  kind: MissionStepKind;
  text: string;
  detail?: string;
};

export type MissionApiMsg = {
  // "system" is used transiently when calling the model; only user/assistant/tool
  // are ever persisted in a mission's history.
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
};

export type PendingCall = { call: any; summary: string };

export type Mission = {
  id: string;
  objective: string;
  objectiveId?: string | null; // the Objective this mission ladders up to (traceability)
  priority?: number; // planner rank; higher = claimed sooner among due queued missions (default 0)
  status: MissionStatus;
  steps: MissionStep[];
  api: MissionApiMsg[]; // running model conversation — enables resume after restart
  pending: PendingCall[]; // tool calls in the current turn awaiting approval
  pendingDecision?: boolean | null; // user's approve/decline answer, applied by the worker on resume
  result?: string;
  qcLeft: number; // remaining quality-control revision passes
  attempts?: number; // how many times this mission has been (re)started, for bounded retry
  acknowledged?: boolean; // user has seen the completed result (durable, server-side)
  scheduledFor?: number; // epoch ms; the worker won't start it until due (undefined = now)
  recurrence?: { everyMs: number }; // if set, a fresh run is queued after each completion
  // Concurrency lease: which worker process is executing this mission and until
  // when (epoch ms). Set by an atomic DB claim; refreshed each turn; cleared on
  // completion. Lets multiple worker instances run safely and lets a dead
  // worker's mission be reclaimed once its lease expires.
  workerId?: string;
  leaseExpires?: number;
  createdAt: number;
  updatedAt: number;
};

/** The client never needs the heavy internals — this is what the UI renders. */
export type MissionView = Omit<Mission, "api" | "workerId" | "leaseExpires">;
