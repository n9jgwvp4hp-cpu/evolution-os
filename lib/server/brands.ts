import { read, mutate, uid } from "@/lib/server/db";
import type {
  Brand, BrandColors, AppSettings, OnboardingForm, OnboardingField, FormSubmission,
  LeadSource, Contact, LeadStatus, PipelineStage, BrandEmailConfig, BrandCalendarConfig,
  BrandNotificationSettings, EmailTemplate,
} from "@/lib/types";
import { LEAD_SOURCES, DEFAULT_PIPELINE_STAGES } from "@/lib/types";

/**
 * Multi-brand service — UW Equity (parent) + its subsidiaries.
 *
 * Brand is a cross-cutting scope: contacts, deals, projects, and objectives carry
 * a `brandId`, onboarding forms belong to a brand, and the parent dashboard rolls
 * everything up. This module owns brand + onboarding-form CRUD, the active-brand
 * setting, and turning a form submission into a brand-scoped CRM lead.
 *
 * Seeding is idempotent and lazy (runs on first read), so existing deployments
 * gain the portfolio without a migration and pre-brand data keeps working.
 */

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const DEFAULT_LEAD_SOURCES: LeadSource[] = ["website", "instagram", "referral", "ads"];

/* ---------------- seeding ---------------- */

function defaultNotifications(): BrandNotificationSettings {
  return { newLead: true, missionComplete: true, blocker: true, dailyDigest: false };
}
function defaultEmailConfig(name: string): BrandEmailConfig {
  return {
    fromName: name,
    signature: `— The ${name} Team`,
    templates: [
      { id: uid(), name: "Lead welcome", subject: `Welcome to ${name}`, body: `Hi {{name}},\n\nThanks for reaching out to ${name}. We received your details and a team member will follow up shortly.\n` },
      { id: uid(), name: "Follow-up", subject: `Following up — ${name}`, body: `Hi {{name}},\n\nJust checking in on your project with ${name}. Happy to answer any questions.\n` },
    ],
  };
}
const EVENT_TYPES: Record<string, string[]> = {
  "Prism44": ["Discovery call", "Content review", "Internal meeting"],
  "Quality Management": ["Property inspection", "Site visit", "Internal meeting"],
  "UW Equity": ["Investor meeting", "Underwriting review", "Internal meeting"],
};
function defaultCalendarConfig(name: string): BrandCalendarConfig {
  return { calendarId: undefined, eventTypes: EVENT_TYPES[name] || ["Discovery call", "Internal meeting"] };
}

/** The initial portfolio. UW Equity is the holding company; the rest are its
 *  subsidiaries. Future companies are added via the CRUD API — nothing here is
 *  hard-coded downstream. */
function seedBrands(): Brand[] {
  const now = Date.now();
  const parentId = uid();
  const mk = (
    id: string,
    name: string,
    kind: Brand["kind"],
    parent: string | null,
    isParent: boolean,
    colors: BrandColors,
    services: string[],
  ): Brand => ({
    id, name, slug: slugify(name), kind, parentId: parent, isParent,
    domain: "", website: "", logo: name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
    instagramAccounts: [], emailAccounts: [], services,
    colors, leadSources: [...DEFAULT_LEAD_SOURCES], status: "active",
    pipelineStages: [...DEFAULT_PIPELINE_STAGES],
    email: defaultEmailConfig(name),
    calendar: defaultCalendarConfig(name),
    notifications: defaultNotifications(),
    createdAt: now, updatedAt: now,
  });
  return [
    // Personal is a separate, isolated account — never used for business operations.
    mk(uid(), "Personal", "personal", null, false, { primary: "#64748b", secondary: "#475569", accent: "#94a3b8" }, ["Personal"]),
    mk(parentId, "UW Equity", "holding", null, true, { primary: "#6366f1", secondary: "#0ea5e9", accent: "#22d3ee" }, ["Holding company", "Capital allocation", "Portfolio operations"]),
    mk(uid(), "Prism44", "brand", parentId, false, { primary: "#a855f7", secondary: "#ec4899", accent: "#f472b6" }, ["Content", "Branding", "Production"]),
    mk(uid(), "Quality Management", "brand", parentId, false, { primary: "#10b981", secondary: "#14b8a6", accent: "#34d399" }, ["Property services", "Inspections", "Maintenance"]),
  ];
}

const F = (label: string, type: OnboardingField["type"], required = false, mapsTo?: OnboardingField["mapsTo"], options?: string[]): OnboardingField =>
  ({ id: uid(), label, type, required, mapsTo, options });

/** Brand-specific example onboarding forms (Phase 2 #1 — the given examples). */
function exampleForm(brandId: string, name: string): OnboardingForm {
  const now = Date.now();
  const base = { id: uid(), brandId, status: "active" as const, createdAt: now, updatedAt: now };
  if (name === "Prism44") {
    return {
      ...base, title: "Prism44 — Project Intake", description: "Tell us about your brand and what you need created.",
      fields: [
        F("Full name", "text", true, "name"), F("Email", "email", true, "email"), F("Company", "text", false, "company"),
        F("Social media / website", "url", false), F("Services requested", "multiselect", false, undefined, ["Content creation", "Branding", "Social media", "Video production", "Web design"]),
        F("Budget", "number", false, "budget"), F("Timeline", "select", false, undefined, ["ASAP", "1–3 months", "3–6 months", "Flexible"]),
        F("Inspiration / examples", "textarea", false, "notes"), F("Upload assets", "file", false),
      ],
    };
  }
  if (name === "Quality Management") {
    return {
      ...base, title: "Quality Management — Service Request", description: "Tell us about the property and the work needed.",
      fields: [
        F("Full name", "text", true, "name"), F("Email", "email", true, "email"), F("Property address", "text", false, "notes"),
        F("Number of units", "number", false), F("Type of work", "multiselect", false, undefined, ["Renovation", "Inspection", "Maintenance", "Turnover", "Construction"]),
        F("Photos / videos", "file", false), F("Timeline", "select", false, undefined, ["ASAP", "1–3 months", "Flexible"]),
        F("Budget", "number", false, "budget"), F("Preferred inspection date", "date", false),
      ],
    };
  }
  if (name === "UW Equity") {
    return {
      ...base, title: "UW Equity — Investor Intake", description: "Tell us about your investment criteria.",
      fields: [
        F("Full name", "text", true, "name"), F("Email", "email", true, "email"), F("Entity / investor information", "text", false, "company"),
        F("Acquisition criteria", "textarea", false), F("Capital available", "number", false, "budget"),
        F("Market focus", "multiselect", false, undefined, ["Multifamily", "Retail", "Office", "Industrial", "Mixed-use"]),
        F("Documents", "file", false), F("Notes", "textarea", false, "notes"),
      ],
    };
  }
  // Generic fallback for future brands.
  return {
    ...base, title: `${name} — New Client Intake`, description: `Tell us about your needs and the ${name} team will follow up.`,
    fields: [
      F("Full name", "text", true, "name"), F("Email", "email", true, "email"), F("Phone", "phone", false, "phone"),
      F("What are you looking for?", "textarea", false, "notes"), F("Budget", "number", false, "budget"),
      F("How did you hear about us?", "select", false, undefined, ["Website", "Instagram", "Referral", "Ads", "Other"]),
    ],
  };
}

const KNOWN_BRANDS = ["Prism44", "Quality Management", "UW Equity"];
const RICH_TYPES = ["multiselect", "file", "url", "date"];

/** Idempotently ensure the portfolio + example forms + active-brand setting exist. */
export async function ensureBrandsSeeded(): Promise<void> {
  const need = await read((db) => (db.brands || []).length === 0);
  if (need) {
    await mutate((db) => {
      if ((db.brands || []).length) return; // double-checked under the write lock
      const brands = seedBrands();
      db.brands = brands;
      // Business brands get an example onboarding form; the Personal account does not.
      db.onboardingForms = [...(db.onboardingForms || []), ...brands.filter((b) => b.kind !== "personal").map((b) => exampleForm(b.id, b.name))];
      const parent = brands.find((b) => b.isParent) || brands[0];
      db.settings = { ...(db.settings || { activeBrandId: null }), activeBrandId: parent.id };
    });
  }
  await ensureBrandsUpgraded();
}

/**
 * Backfill Phase 2 operational config onto brands seeded by an earlier version
 * (existing deployments): pipeline stages, email/calendar identity, notifications,
 * and the richer brand-specific example onboarding forms. Idempotent — a no-op
 * once every brand is upgraded, so it is safe to call on every read.
 */
async function ensureBrandsUpgraded(): Promise<void> {
  const genericTitle = (name: string) => `${name} — New Client Intake`;
  const hasGeneric = (forms: OnboardingForm[], brandId: string, name: string) =>
    forms.some((f) => f.brandId === brandId && f.title === genericTitle(name));

  const needsWork = await read((db) => {
    const brands = db.brands || [];
    if (brands.some((b) => !b.pipelineStages || !b.email || !b.calendar || !b.notifications || !b.kind)) return true;
    if (!brands.some((b) => b.kind === "personal")) return true; // Personal account not seeded yet
    // A known brand still carrying the OLD generic default form gets it swapped for the rich example.
    return brands.some((b) => KNOWN_BRANDS.includes(b.name) && hasGeneric(db.onboardingForms || [], b.id, b.name));
  });
  if (!needsWork) return;

  await mutate((db) => {
    for (const b of db.brands || []) {
      if (!b.pipelineStages) b.pipelineStages = [...DEFAULT_PIPELINE_STAGES];
      if (!b.email) b.email = defaultEmailConfig(b.name);
      if (!b.calendar) b.calendar = defaultCalendarConfig(b.name);
      if (!b.notifications) b.notifications = defaultNotifications();
      if (b.website === undefined) b.website = "";
      // Backfill account type: the parent holding company vs. a business subsidiary.
      if (!b.kind) b.kind = b.isParent ? "holding" : "brand";
    }
    // Seed the separate Personal account if it doesn't exist yet.
    if (!(db.brands || []).some((b) => b.kind === "personal")) {
      const now = Date.now();
      db.brands = [
        {
          id: uid(), name: "Personal", slug: "personal", kind: "personal", parentId: null, isParent: false,
          domain: "", website: "", logo: "P", instagramAccounts: [], emailAccounts: [], services: ["Personal"],
          colors: { primary: "#64748b", secondary: "#475569", accent: "#94a3b8" },
          leadSources: [...DEFAULT_LEAD_SOURCES], status: "active",
          pipelineStages: [...DEFAULT_PIPELINE_STAGES], email: defaultEmailConfig("Personal"),
          calendar: defaultCalendarConfig("Personal"), notifications: defaultNotifications(),
          createdAt: now, updatedAt: now,
        },
        ...(db.brands || []),
      ];
    }
    // Swap the stale auto-seeded generic intake form for the rich brand-specific
    // example (safe — those were defaults, not user-authored). Deterministic by title.
    for (const b of db.brands || []) {
      if (!KNOWN_BRANDS.includes(b.name)) continue;
      if (!hasGeneric(db.onboardingForms || [], b.id, b.name)) continue;
      db.onboardingForms = (db.onboardingForms || []).filter((f) => !(f.brandId === b.id && f.title === genericTitle(b.name)));
      db.onboardingForms = [exampleForm(b.id, b.name), ...(db.onboardingForms || [])]; // prepend so it is the brand's primary form
    }
  });
}

/* ---------------- brand CRUD ---------------- */

export async function listBrands(): Promise<Brand[]> {
  await ensureBrandsSeeded();
  return read((db) => db.brands || []);
}
export async function getBrand(id: string): Promise<Brand | undefined> {
  await ensureBrandsSeeded();
  return read((db) => (db.brands || []).find((b) => b.id === id));
}

export async function createBrand(input: Partial<Brand>): Promise<Brand> {
  await ensureBrandsSeeded();
  const now = Date.now();
  let brand!: Brand;
  await mutate((db) => {
    const parent = (db.brands || []).find((b) => b.isParent);
    brand = {
      id: uid(),
      name: String(input.name || "Untitled Brand").slice(0, 120),
      slug: slugify(String(input.name || uid())),
      kind: "brand", // future companies are business subsidiaries
      // New brands default to subsidiaries of the parent holding company.
      parentId: input.parentId !== undefined ? input.parentId : parent?.id ?? null,
      isParent: false,
      domain: input.domain ? String(input.domain).slice(0, 200) : "",
      website: input.website ? String(input.website).slice(0, 300) : "",
      logo: input.logo ? String(input.logo).slice(0, 300) : String(input.name || "?").slice(0, 3).toUpperCase(),
      instagramAccounts: sanitizeList(input.instagramAccounts),
      emailAccounts: sanitizeList(input.emailAccounts),
      services: sanitizeList(input.services),
      colors: normalizeColors(input.colors),
      leadSources: sanitizeSources(input.leadSources),
      status: "active",
      // Future companies get the same operational defaults as the seeded ones.
      pipelineStages: normalizeStages(input.pipelineStages),
      email: input.email ? normalizeEmailConfig(input.email, String(input.name || "Brand")) : defaultEmailConfig(String(input.name || "Brand")),
      calendar: input.calendar ? normalizeCalendarConfig(input.calendar) : defaultCalendarConfig(String(input.name || "Brand")),
      notifications: input.notifications ? { ...defaultNotifications(), ...input.notifications } : defaultNotifications(),
      createdAt: now, updatedAt: now,
    };
    db.brands = [...(db.brands || []), brand];
  });
  return brand;
}

const BRAND_EDITABLE: (keyof Brand)[] = ["name", "domain", "website", "logo", "instagramAccounts", "emailAccounts", "services", "colors", "leadSources", "status", "parentId", "pipelineStages", "email", "calendar", "notifications"];

export async function patchBrand(id: string, input: Partial<Brand>): Promise<Brand | undefined> {
  await ensureBrandsSeeded();
  let out: Brand | undefined;
  await mutate((db) => {
    const b = (db.brands || []).find((x) => x.id === id);
    if (!b) return;
    for (const k of BRAND_EDITABLE) {
      if (!(k in input)) continue;
      if (k === "instagramAccounts" || k === "emailAccounts" || k === "services") (b as any)[k] = sanitizeList((input as any)[k]);
      else if (k === "leadSources") b.leadSources = sanitizeSources(input.leadSources);
      else if (k === "pipelineStages") b.pipelineStages = normalizeStages(input.pipelineStages);
      else if (k === "email") b.email = normalizeEmailConfig(input.email, b.name);
      else if (k === "calendar") b.calendar = normalizeCalendarConfig(input.calendar);
      else if (k === "notifications") b.notifications = { ...defaultNotifications(), ...b.notifications, ...input.notifications };
      else if (k === "colors") b.colors = normalizeColors(input.colors);
      else if (k === "name") { b.name = String(input.name).slice(0, 120); b.slug = slugify(b.name); }
      else (b as any)[k] = (input as any)[k];
    }
    b.updatedAt = Date.now();
    out = b;
  });
  return out;
}

/** Delete a brand. The parent holding company cannot be deleted. Scoped data is
 *  preserved (its brandId is left intact but simply orphaned) — never destroyed. */
export async function deleteBrand(id: string): Promise<{ ok: boolean; error?: string }> {
  await ensureBrandsSeeded();
  let result: { ok: boolean; error?: string } = { ok: true };
  await mutate((db) => {
    const b = (db.brands || []).find((x) => x.id === id);
    if (!b) { result = { ok: false, error: "not found" }; return; }
    if (b.isParent) { result = { ok: false, error: "cannot delete the parent holding company" }; return; }
    db.brands = (db.brands || []).filter((x) => x.id !== id);
    db.onboardingForms = (db.onboardingForms || []).filter((f) => f.brandId !== id);
    if (db.settings?.activeBrandId === id) {
      db.settings.activeBrandId = (db.brands.find((x) => x.isParent) || db.brands[0])?.id ?? null;
    }
  });
  return result;
}

/* ---------------- active brand ---------------- */

export async function getSettings(): Promise<AppSettings> {
  await ensureBrandsSeeded();
  return read((db) => db.settings || { activeBrandId: null });
}
export async function setActiveBrand(brandId: string | null): Promise<AppSettings> {
  await ensureBrandsSeeded();
  let out: AppSettings = { activeBrandId: null };
  await mutate((db) => {
    const valid = brandId == null || (db.brands || []).some((b) => b.id === brandId);
    db.settings = { ...(db.settings || { activeBrandId: null }), activeBrandId: valid ? brandId : db.settings?.activeBrandId ?? null };
    out = db.settings;
  });
  return out;
}

/* ---------------- onboarding forms ---------------- */

export async function listForms(brandId?: string): Promise<OnboardingForm[]> {
  await ensureBrandsSeeded();
  return read((db) => (db.onboardingForms || []).filter((f) => !brandId || f.brandId === brandId));
}
export async function getForm(id: string): Promise<OnboardingForm | undefined> {
  await ensureBrandsSeeded();
  return read((db) => (db.onboardingForms || []).find((f) => f.id === id));
}
export async function createForm(input: Partial<OnboardingForm>): Promise<OnboardingForm> {
  await ensureBrandsSeeded();
  const now = Date.now();
  const form: OnboardingForm = {
    id: uid(),
    brandId: String(input.brandId || ""),
    title: String(input.title || "Onboarding form").slice(0, 200),
    description: input.description ? String(input.description).slice(0, 1000) : "",
    fields: normalizeFields(input.fields),
    status: input.status === "disabled" ? "disabled" : "active",
    createdAt: now, updatedAt: now,
  };
  await mutate((db) => { db.onboardingForms = [...(db.onboardingForms || []), form]; });
  return form;
}
export async function patchForm(id: string, input: Partial<OnboardingForm>): Promise<OnboardingForm | undefined> {
  await ensureBrandsSeeded();
  let out: OnboardingForm | undefined;
  await mutate((db) => {
    const f = (db.onboardingForms || []).find((x) => x.id === id);
    if (!f) return;
    if (input.title != null) f.title = String(input.title).slice(0, 200);
    if (input.description != null) f.description = String(input.description).slice(0, 1000);
    if (input.status) f.status = input.status === "disabled" ? "disabled" : "active";
    if (input.brandId) f.brandId = String(input.brandId);
    if (input.fields) f.fields = normalizeFields(input.fields);
    f.updatedAt = Date.now();
    out = f;
  });
  return out;
}
export async function deleteForm(id: string): Promise<boolean> {
  await ensureBrandsSeeded();
  let ok = false;
  await mutate((db) => {
    const before = (db.onboardingForms || []).length;
    db.onboardingForms = (db.onboardingForms || []).filter((f) => f.id !== id);
    ok = (db.onboardingForms || []).length < before;
  });
  return ok;
}

const SUBMISSION_CAP = 500;

/**
 * Submit an onboarding form → create a brand-scoped CRM lead with lead-source
 * attribution, and record the submission. This is where requirements 3/4/5 meet:
 * a brand's form produces a lead in that brand's pipeline, tagged by source.
 */
export async function submitForm(
  formId: string,
  data: Record<string, any>,
  leadSourceInput?: string,
  campaign?: string,
): Promise<{ ok: boolean; error?: string; submissionId?: string; contactId?: string; brandId?: string }> {
  await ensureBrandsSeeded();
  let result: { ok: boolean; error?: string; submissionId?: string; contactId?: string; brandId?: string } = { ok: false, error: "not found" };
  await mutate((db) => {
    const form = (db.onboardingForms || []).find((f) => f.id === formId);
    if (!form) { result = { ok: false, error: "form not found" }; return; }
    if (form.status !== "active") { result = { ok: false, error: "form is disabled" }; return; }

    // Map answers → Contact fields via each field's `mapsTo`. Multi-value answers
    // (multiselect) are joined; file answers keep their metadata as text.
    const mapped: Record<string, any> = {};
    for (const field of form.fields) {
      let v = data[field.id] ?? data[field.label];
      if (v == null || v === "") continue;
      if (Array.isArray(v)) v = v.join(", ");
      if (field.mapsTo) mapped[field.mapsTo] = v;
    }
    const leadSource = coerceSource(leadSourceInput) || inferSource(data, form) || "website";
    const camp = campaign ? String(campaign).slice(0, 120) : undefined;

    const now = Date.now();
    const contactId = uid();
    const notesParts = [mapped.notes, mapped.company ? `Company: ${mapped.company}` : ""].filter(Boolean);
    const contact: Contact = {
      id: contactId,
      brandId: form.brandId,
      name: String(mapped.name || "New lead").slice(0, 160),
      email: String(mapped.email || "").slice(0, 200),
      phone: String(mapped.phone || "").slice(0, 60),
      type: "other",
      status: "new" as LeadStatus,
      source: `onboarding:${form.title}`,
      leadSource,
      campaign: camp,
      company: mapped.company ? String(mapped.company).slice(0, 160) : undefined,
      budget: Number(mapped.budget) || 0,
      notes: String(notesParts.join("\n")).slice(0, 2000),
      lastTouch: now, createdAt: now,
    };
    db.contacts = [contact, ...(db.contacts || [])];

    const submission: FormSubmission = {
      id: uid(), formId, brandId: form.brandId, data, leadSource, campaign: camp, contactId, createdAt: now,
    };
    db.formSubmissions = [submission, ...(db.formSubmissions || [])].slice(0, SUBMISSION_CAP);
    result = { ok: true, submissionId: submission.id, contactId, brandId: form.brandId };
  });
  return result;
}

export async function listSubmissions(brandId?: string): Promise<FormSubmission[]> {
  await ensureBrandsSeeded();
  return read((db) => (db.formSubmissions || []).filter((s) => !brandId || s.brandId === brandId));
}

/* ---------------- helpers ---------------- */
function sanitizeList(x: any): string[] {
  return Array.isArray(x) ? x.map((s) => String(s).slice(0, 200)).filter(Boolean).slice(0, 40) : [];
}
function sanitizeSources(x: any): LeadSource[] {
  const arr = Array.isArray(x) ? x : DEFAULT_LEAD_SOURCES;
  const out = arr.map((s: any) => coerceSource(s)).filter(Boolean) as LeadSource[];
  return out.length ? Array.from(new Set(out)) : [...DEFAULT_LEAD_SOURCES];
}
function normalizeColors(c: any): BrandColors {
  const hex = (v: any, fallback: string) => (typeof v === "string" && /^#?[0-9a-fA-F]{3,8}$/.test(v) ? (v.startsWith("#") ? v : `#${v}`) : fallback);
  return { primary: hex(c?.primary, "#6366f1"), secondary: hex(c?.secondary, "#0ea5e9"), accent: hex(c?.accent, "#22d3ee") };
}
function normalizeFields(fields: any): OnboardingField[] {
  if (!Array.isArray(fields)) return [];
  const types = ["text", "email", "phone", "textarea", "select", "multiselect", "file", "date", "url", "number"];
  const maps = ["name", "email", "phone", "budget", "notes", "type", "company"];
  return fields.slice(0, 60).map((f: any) => {
    const showIf = f?.showIf && f.showIf.fieldId
      ? { fieldId: String(f.showIf.fieldId), equals: String(f.showIf.equals ?? "") }
      : undefined;
    return {
      id: f?.id ? String(f.id) : uid(),
      label: String(f?.label || "Field").slice(0, 160),
      type: (types.includes(f?.type) ? f.type : "text") as OnboardingField["type"],
      required: Boolean(f?.required),
      options: Array.isArray(f?.options) ? f.options.map((o: any) => String(o).slice(0, 120)).slice(0, 30) : undefined,
      placeholder: f?.placeholder ? String(f.placeholder).slice(0, 160) : undefined,
      mapsTo: maps.includes(f?.mapsTo) ? f.mapsTo : undefined,
      showIf,
    };
  });
}
function normalizeStages(stages: any): PipelineStage[] {
  if (!Array.isArray(stages) || !stages.length) return [...DEFAULT_PIPELINE_STAGES];
  const out = stages.slice(0, 20).map((s: any) => {
    const label = String(s?.label || s?.key || "Stage").slice(0, 60);
    const key = String(s?.key || slugify(label) || uid()).slice(0, 40);
    return { key, label };
  }).filter((s: PipelineStage) => s.key && s.label);
  return out.length ? out : [...DEFAULT_PIPELINE_STAGES];
}
function normalizeEmailConfig(c: any, brandName: string): BrandEmailConfig {
  const base = defaultEmailConfig(brandName);
  if (!c || typeof c !== "object") return base;
  const templates: EmailTemplate[] = Array.isArray(c.templates)
    ? c.templates.slice(0, 40).map((t: any) => ({
        id: t?.id ? String(t.id) : uid(),
        name: String(t?.name || "Template").slice(0, 120),
        subject: String(t?.subject || "").slice(0, 240),
        body: String(t?.body || "").slice(0, 6000),
      }))
    : base.templates;
  return {
    fromName: c.fromName ? String(c.fromName).slice(0, 120) : base.fromName,
    connectedEmail: c.connectedEmail ? String(c.connectedEmail).slice(0, 200) : undefined,
    signature: c.signature != null ? String(c.signature).slice(0, 1000) : base.signature,
    templates,
  };
}
function normalizeCalendarConfig(c: any): BrandCalendarConfig {
  return {
    calendarId: c?.calendarId ? String(c.calendarId).slice(0, 200) : undefined,
    eventTypes: Array.isArray(c?.eventTypes) ? c.eventTypes.map((e: any) => String(e).slice(0, 80)).slice(0, 20) : [],
  };
}
function coerceSource(s: any): LeadSource | null {
  if (!s) return null;
  const v = String(s).toLowerCase().trim();
  return (LEAD_SOURCES as string[]).includes(v) ? (v as LeadSource) : null;
}
function inferSource(data: Record<string, any>, form: OnboardingForm): LeadSource | null {
  const hint = form.fields.find((f) => /hear about|source|referr/i.test(f.label));
  const raw = hint ? String(data[hint.id] ?? data[hint.label] ?? "").toLowerCase() : "";
  return coerceSource(raw);
}
