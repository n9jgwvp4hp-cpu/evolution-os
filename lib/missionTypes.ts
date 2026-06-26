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
  | "done"
  | "failed";

export type MissionStepKind = "plan" | "progress" | "action" | "result" | "error";

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
  status: MissionStatus;
  steps: MissionStep[];
  api: MissionApiMsg[]; // running model conversation — enables resume after restart
  pending: PendingCall[]; // tool calls in the current turn awaiting approval
  result?: string;
  qcLeft: number; // remaining quality-control revision passes
  acknowledged?: boolean; // user has seen the completed result (durable, server-side)
  createdAt: number;
  updatedAt: number;
};

/** The client never needs the heavy internals — this is what the UI renders. */
export type MissionView = Omit<Mission, "api">;
