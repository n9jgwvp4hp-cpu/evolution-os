/**
 * Shared entity types — the shape of Evolution OS's persistent brain.
 * Pure types, safe to import from both client and server. No "use client".
 */

export type Project = {
  id: string;
  brandId?: string | null; // which brand this project belongs to (multi-brand scoping)
  name: string;
  description: string;
  status: "planning" | "active" | "done";
  createdAt: number;
};

/* =========================================================================
 * Multi-brand architecture. UW Equity is the parent (holding) company;
 * Prism44, Quality Management, and future companies are its subsidiaries.
 * Brand is a cross-cutting dimension: contacts, deals, projects, objectives,
 * onboarding forms, and lead sources all scope to a brand, and the parent
 * dashboard rolls everything up across the portfolio.
 * ========================================================================= */

/** How a lead found a brand. Configurable per brand; these are the defaults. */
export type LeadSource = "website" | "instagram" | "referral" | "ads" | "email" | "manual" | "direct" | "other";
export const LEAD_SOURCES: LeadSource[] = ["website", "instagram", "referral", "ads", "email", "manual", "direct", "other"];

/** Full lead-origin attribution — the who/where/when a lead came from. */
export type LeadAttribution = {
  brandId: string | null;
  source: LeadSource;
  campaign?: string;   // e.g. "spring-ig-launch", "google-ads-brand"
  channel?: string;    // e.g. specific IG handle, ad group, referrer name
  timestamp: number;
};

export type BrandColors = {
  primary: string;    // brand primary (hex)
  secondary?: string;
  accent?: string;
};

export type Brand = {
  id: string;
  name: string;                 // "UW Equity", "Prism44", "Quality Management"
  slug: string;                 // "uw-equity", "prism44"
  parentId: string | null;      // subsidiaries point to the parent; the parent's is null
  isParent: boolean;            // true only for UW Equity (the holding company)
  domain?: string;
  website?: string;             // public site URL (may differ from bare domain)
  logo?: string;                // URL or short initials/emoji (no asset pipeline yet)
  instagramAccounts: string[];
  emailAccounts: string[];
  services: string[];
  colors: BrandColors;
  leadSources: LeadSource[];    // which sources are enabled for this brand
  status: "active" | "paused" | "archived";
  // ---- operational config (Phase 2) ----
  pipelineStages?: PipelineStage[];        // this brand's editable CRM pipeline
  email?: BrandEmailConfig;                // brand Gmail identity + templates + signature
  calendar?: BrandCalendarConfig;          // brand calendar selection + event types
  notifications?: BrandNotificationSettings;
  createdAt: number;
  updatedAt: number;
};

/** One stage in a brand's editable CRM pipeline. */
export type PipelineStage = { key: string; label: string };

/** Default pipeline for a new brand (requirement #2). */
export const DEFAULT_PIPELINE_STAGES: PipelineStage[] = [
  { key: "new_lead", label: "New Lead" },
  { key: "qualified", label: "Qualified" },
  { key: "proposal_sent", label: "Proposal Sent" },
  { key: "negotiation", label: "Negotiation" },
  { key: "active_client", label: "Active Client" },
  { key: "completed", label: "Completed" },
];

export type EmailTemplate = {
  id: string;
  name: string;      // "Lead welcome", "Proposal follow-up"
  subject: string;
  body: string;      // may contain {{name}}, {{brand}} tokens
};

/** Brand email identity. `connectedEmail` is the Gmail address whose OAuth the
 *  brand sends from (per-brand connection is the one credential step); until then
 *  the OS falls back to the primary connected account but stamps this identity. */
export type BrandEmailConfig = {
  fromName?: string;           // display name on outbound mail
  connectedEmail?: string;     // brand Gmail address (once its OAuth is connected)
  signature?: string;
  templates: EmailTemplate[];
};

export type BrandCalendarConfig = {
  calendarId?: string;         // Google calendar id for this brand ("primary" fallback)
  eventTypes?: string[];       // "Discovery call", "Property inspection", "Investor meeting", …
};

export type BrandNotificationSettings = {
  newLead: boolean;
  missionComplete: boolean;
  blocker: boolean;
  dailyDigest: boolean;
};

/** App-wide UI/runtime settings (single-user OS). */
export type AppSettings = {
  activeBrandId: string | null; // the brand currently in focus (drives the switcher + scoped views)
};

export type OnboardingFieldType =
  | "text" | "email" | "phone" | "textarea" | "select"
  | "multiselect" | "file" | "date" | "url" | "number";

/** One field in a brand's onboarding form. `mapsTo` links the answer to a Contact
 *  field so a submission becomes a real CRM lead automatically. `showIf` makes the
 *  field conditional on another field's answer (no-code branching). */
export type OnboardingField = {
  id: string;
  label: string;
  type: OnboardingFieldType;
  required: boolean;
  options?: string[]; // for "select" / "multiselect"
  placeholder?: string;
  mapsTo?: "name" | "email" | "phone" | "budget" | "notes" | "type" | "company";
  showIf?: { fieldId: string; equals: string }; // conditional display
};

export type OnboardingForm = {
  id: string;
  brandId: string;
  title: string;
  description?: string;
  fields: OnboardingField[];
  status: "active" | "disabled";
  createdAt: number;
  updatedAt: number;
};

export type FormSubmission = {
  id: string;
  formId: string;
  brandId: string;
  data: Record<string, any>;
  leadSource: LeadSource;
  campaign?: string;
  contactId: string | null; // the CRM lead this submission created
  createdAt: number;
};

/* ---- Mission templates (Phase 2 #3): configurable per brand; auto-instantiated
 *      when a lead enters that brand's CRM. ---- */
export type MissionTemplateStep = {
  id: string;
  objective: string;   // the mission objective text; supports {{lead}} / {{brand}} tokens
  order: number;
  offsetMinutes?: number; // schedule this step N minutes after intake (staggering)
};
export type MissionTemplate = {
  id: string;
  brandId: string;
  name: string;
  trigger: "lead_created" | "manual";
  steps: MissionTemplateStep[];
  status: "active" | "disabled";
  createdAt: number;
  updatedAt: number;
};

/* ---- Global activity feed (Phase 2 #6): the "what happened while I was away"
 *      log. Append-only + bounded. ---- */
export type ActivityKind =
  | "mission_created" | "mission_completed" | "mission_failed"
  | "email_sent" | "email_drafted" | "meeting_scheduled"
  | "new_lead" | "revenue_change" | "pipeline_update"
  | "approval_needed" | "brand_change" | "error" | "blocker";
export type Activity = {
  id: string;
  brandId: string | null;
  kind: ActivityKind;
  title: string;
  detail?: string;
  refType?: string; // "mission" | "contact" | "deal" | "brand" | …
  refId?: string;
  createdAt: number;
};

/* ---- Approval queue (Phase 2 #7): the OS runs autonomously and only raises an
 *      approval for money / contracts / external meetings / brand-setting changes /
 *      missing info. Mission-gated approvals are surfaced alongside these. ---- */
export type ApprovalReason = "money" | "contract" | "external_meeting" | "brand_setting" | "missing_info" | "other";
export type Approval = {
  id: string;
  brandId: string | null;
  reason: ApprovalReason;
  title: string;
  detail?: string;
  action?: { type: string; payload?: any }; // what will run on approval
  status: "pending" | "approved" | "declined";
  missionId?: string | null; // if this approval gates a mission
  createdAt: number;
  resolvedAt?: number | null;
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
  brandId?: string | null; // which brand's pipeline this lead belongs to
  name: string;
  email: string;
  phone: string;
  type: "buyer" | "seller" | "investor" | "renter" | "other";
  status: LeadStatus;
  source: string; // free-form origin note (kept for back-compat)
  leadSource?: LeadSource; // structured lead-source attribution (website/instagram/referral/ads/…)
  campaign?: string; // marketing campaign / channel that produced this lead
  budget: number; // 0 = unknown
  notes: string;
  // ---- brand CRM pipeline fields (Phase 2) ----
  pipelineStage?: string;        // key into the brand's pipelineStages
  owner?: string;                // who owns this lead
  nextAction?: string;           // the next step for this lead
  revenue?: number;              // realized/expected revenue attributed to this lead
  attachedMissionIds?: string[]; // missions auto-generated / linked to this lead
  lastContact?: number;          // last outreach timestamp
  company?: string;              // company name (B2B brands)
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
  brandId?: string | null; // which brand's pipeline this deal belongs to
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

/* =========================================================================
 * The life-OS hierarchy: Identity → Vision → Objectives → Missions → Execution.
 * Everything the OS does traces up to an Objective; every Objective supports a
 * Vision; both are grounded in the user's Identity.
 * ========================================================================= */

/** IDENTITY — who the user is and what they value. A singleton. */
export type Identity = {
  name?: string;
  roles?: string[];       // "Real-estate investor", "Founder of Prism44"
  values?: string[];      // what matters to them
  principles?: string[];  // how they operate / decide
  bio?: string;           // free-form context the OS should always know
  updatedAt: number;
};

/** VISION — a long-term future the user is building (a life/business pillar). */
export type Vision = {
  id: string;
  title: string;          // "Build Prism44 into the leading …"
  description: string;
  horizon?: string;       // "3–5 years"
  status: "active" | "paused" | "archived";
  createdAt: number;
  updatedAt: number;
};

/** OBJECTIVE — a measurable outcome that moves a Vision forward. Missions ladder
 *  up to an Objective; the OS maintains its evolving `state` + `progress`. */
export type Objective = {
  id: string;
  brandId?: string | null; // which brand this objective advances (portfolio scoping)
  visionId: string | null; // the Vision it supports (traceability up)
  title: string;           // "Grow Prism44 to $50k MRR"
  description: string;
  metric?: string;         // measurable dimension, e.g. "MRR"
  target?: string;         // "$50,000/mo"
  current?: string;        // latest known value
  status: "active" | "paused" | "done";
  priority: number;        // 1–5
  state: string;           // OS-maintained evolving summary (updated by reasoning)
  progress: number;        // 0–100, OS-estimated
  createdAt: number;
  updatedAt: number;
  lastReviewedAt: number | null;
};

/**
 * A ranked item in the executive-assistant Priority Queue. The kernel produces
 * these each cycle by analyzing Gmail, Calendar, CRM, missions, and pending work.
 * Ranking is deterministic (see setPriorities): score is derived from the signals
 * below, and `why` explains — in plain language — why the item was generated.
 */
export type Priority = {
  id: string;
  objectiveId?: string | null; // the Objective this recommendation serves (traceability)
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
export type BrainKind = "tasks" | "projects" | "contacts" | "deals" | "notes" | "memories" | "priorities";
