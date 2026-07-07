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

/** Collections that live in the shared server brain (files stay client-side). */
export type BrainKind = "tasks" | "contacts" | "deals" | "notes" | "memories" | "priorities";
