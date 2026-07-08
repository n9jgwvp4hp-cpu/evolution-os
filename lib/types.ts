/**
 * Shared entity types — the shape of Evolution OS's persistent brain.
 * Pure types, safe to import from both client and server. No "use client".
 */

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
  dataUrl: string; // base64 content, stored locally in the browser
  createdAt: number;
  tags?: string;
};

export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "nurturing"
  | "client"
  | "closed"
  | "lost";

export type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: "buyer" | "seller" | "investor" | "renter" | "other";
  status: LeadStatus;
  source: string;
  budget: number; // 0 = unknown
  notes: string;
  lastTouch: number;
  createdAt: number;
};

export type DealStage =
  | "lead"
  | "showing"
  | "offer"
  | "under_contract"
  | "closed"
  | "lost";

export type Deal = {
  id: string;
  address: string;
  price: number;
  side: "buy" | "sell";
  stage: DealStage;
  contactId: string | null;
  commission: number;
  closeDate: string; // ISO date string, optional
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type Memory = {
  id: string;
  text: string;
  category: "personal" | "business" | "preference" | "fact" | "other";
  pinned: boolean;
  createdAt: number;
};

/**
 * A ranked item in the executive-assistant Priority Queue. The kernel produces
 * these each cycle by analyzing Gmail, Calendar, CRM, missions, and pending work.
 * Ranking is deterministic (see setPriorities): score is derived from the signals
 * below, and `why` explains — in plain language — why the item was generated.
 */
export type Priority = {
  id: string;
  title: string;
  category: "email" | "calendar" | "crm" | "mission" | "task" | "other";
  urgency: number; // 1–5 (time pressure)
  importance: number; // 1–5 (impact if done / cost if missed)
  deadline?: string; // ISO date, optional
  dependsOn?: string; // what blocks this, optional
  score: number; // computed rank (higher = do sooner)
  recommendedAction: string; // the concrete next action
  why: string; // REQUIRED rationale — why this surfaced now
  source: string; // e.g. "gmail:eric@…", "calendar", "deal:123 Main St"
  createdAt: number;
  updatedAt: number;
};

/**
 * Live status of the Continuous Workflow Orchestrator, surfaced in the Command
 * Center. The orchestrator (a local script that drives Claude Code against the
 * roadmap) POSTs this to /api/orchestrator each phase so the deployed dashboard
 * can show it regardless of which machine the loop runs on.
 */
export type OrchestratorStatus = {
  running: boolean;
  mode: string; // "manual" | "daemon" — whether the persistent runner is driving
  phase: string; // idle | implementing | verifying | deploying | health-check | done | blocked | failed | stopped
  currentMilestone: string | null;
  attempt: number;
  maxRetries: number;
  message: string;
  lastRunAt: number;
  nextRunAt: number | null; // when the persistent runner will next check/run (epoch ms)
  recent: { ts: number; text: string }[]; // tail of the run log
  milestones: { id: string; title: string; status: string; attempts: number }[];
};

/**
 * An automation rule: the Event Engine watches a supported integration and, when
 * the rule's condition fires, queues a mission from `objective`. Runtime fields
 * (`seen`, counts) provide dedup + observability. Missions are safe-only for now
 * (no autonomous outward actions).
 */
export type AutomationRule = {
  id: string;
  name: string;
  enabled: boolean;
  type: "email" | "calendar" | "schedule" | "webhook";
  // condition config (per type)
  from?: string;            // email: sender contains
  subjectContains?: string; // email: subject contains
  leadMinutes?: number;     // calendar: fire this many minutes before an event
  atTime?: string;          // schedule: "HH:MM" (UTC) daily
  everyMinutes?: number;    // schedule: alternative fixed cadence
  webhookToken?: string;    // webhook: secret path token
  objective: string;        // the mission template to queue when it fires
  // runtime
  seen: string[];           // dedup keys already triggered (bounded)
  triggerCount: number;
  lastTriggeredAt: number | null;
  createdAt: number;
};

/** One recorded trigger — every fire is logged here for the Command Center. */
export type TriggerEvent = {
  ts: number;
  ruleId: string;
  ruleName: string;
  type: string;
  event: string;      // human description of what fired it
  missionId: string;
};

/** Collections that live in the shared server brain (files stay client-side). */
export type BrainKind = "tasks" | "contacts" | "deals" | "notes" | "memories" | "priorities";
