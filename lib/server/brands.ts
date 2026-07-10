import { read, mutate, uid } from "@/lib/server/db";
import type {
  Brand, BrandColors, AppSettings, OnboardingForm, OnboardingField, FormSubmission,
  LeadSource, Contact, LeadStatus,
} from "@/lib/types";
import { LEAD_SOURCES } from "@/lib/types";

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

/** The initial portfolio. UW Equity is the holding company; the rest are its
 *  subsidiaries. Future companies are added via the CRUD API — nothing here is
 *  hard-coded downstream. */
function seedBrands(): Brand[] {
  const now = Date.now();
  const parentId = uid();
  const mk = (
    id: string,
    name: string,
    parent: string | null,
    isParent: boolean,
    colors: BrandColors,
    services: string[],
  ): Brand => ({
    id, name, slug: slugify(name), parentId: parent, isParent,
    domain: "", logo: name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase(),
    instagramAccounts: [], emailAccounts: [], services,
    colors, leadSources: [...DEFAULT_LEAD_SOURCES], status: "active",
    createdAt: now, updatedAt: now,
  });
  return [
    mk(parentId, "UW Equity", null, true, { primary: "#6366f1", secondary: "#0ea5e9", accent: "#22d3ee" }, ["Holding company", "Capital allocation", "Portfolio operations"]),
    mk(uid(), "Prism44", parentId, false, { primary: "#a855f7", secondary: "#ec4899", accent: "#f472b6" }, []),
    mk(uid(), "Quality Management", parentId, false, { primary: "#10b981", secondary: "#14b8a6", accent: "#34d399" }, []),
  ];
}

function defaultForm(brandId: string, brandName: string): OnboardingForm {
  const now = Date.now();
  const f = (label: string, type: OnboardingField["type"], required: boolean, mapsTo?: OnboardingField["mapsTo"], options?: string[]): OnboardingField =>
    ({ id: uid(), label, type, required, mapsTo, options });
  return {
    id: uid(), brandId, title: `${brandName} — New Client Intake`,
    description: `Tell us about your needs and the ${brandName} team will follow up.`,
    fields: [
      f("Full name", "text", true, "name"),
      f("Email", "email", true, "email"),
      f("Phone", "phone", false, "phone"),
      f("What are you looking for?", "textarea", false, "notes"),
      f("Budget", "number", false, "budget"),
      f("How did you hear about us?", "select", false, undefined, ["Website", "Instagram", "Referral", "Ads", "Other"]),
    ],
    status: "active", createdAt: now, updatedAt: now,
  };
}

/** Idempotently ensure the portfolio + default forms + active-brand setting exist. */
export async function ensureBrandsSeeded(): Promise<void> {
  const need = await read((db) => (db.brands || []).length === 0);
  if (!need) return;
  await mutate((db) => {
    if ((db.brands || []).length) return; // double-checked under the write lock
    const brands = seedBrands();
    db.brands = brands;
    const subs = brands.filter((b) => !b.isParent);
    db.onboardingForms = [...(db.onboardingForms || []), ...subs.map((b) => defaultForm(b.id, b.name))];
    const parent = brands.find((b) => b.isParent) || brands[0];
    db.settings = { ...(db.settings || { activeBrandId: null }), activeBrandId: parent.id };
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
      // New brands default to subsidiaries of the parent holding company.
      parentId: input.parentId !== undefined ? input.parentId : parent?.id ?? null,
      isParent: false,
      domain: input.domain ? String(input.domain).slice(0, 200) : "",
      logo: input.logo ? String(input.logo).slice(0, 300) : String(input.name || "?").slice(0, 3).toUpperCase(),
      instagramAccounts: sanitizeList(input.instagramAccounts),
      emailAccounts: sanitizeList(input.emailAccounts),
      services: sanitizeList(input.services),
      colors: normalizeColors(input.colors),
      leadSources: sanitizeSources(input.leadSources),
      status: "active",
      createdAt: now, updatedAt: now,
    };
    db.brands = [...(db.brands || []), brand];
  });
  return brand;
}

const BRAND_EDITABLE: (keyof Brand)[] = ["name", "domain", "logo", "instagramAccounts", "emailAccounts", "services", "colors", "leadSources", "status", "parentId"];

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
): Promise<{ ok: boolean; error?: string; submissionId?: string; contactId?: string; brandId?: string }> {
  await ensureBrandsSeeded();
  let result: { ok: boolean; error?: string; submissionId?: string; contactId?: string; brandId?: string } = { ok: false, error: "not found" };
  await mutate((db) => {
    const form = (db.onboardingForms || []).find((f) => f.id === formId);
    if (!form) { result = { ok: false, error: "form not found" }; return; }
    if (form.status !== "active") { result = { ok: false, error: "form is disabled" }; return; }

    // Map answers → Contact fields via each field's `mapsTo`.
    const mapped: Record<string, any> = {};
    for (const field of form.fields) {
      const v = data[field.id] ?? data[field.label];
      if (v == null || v === "") continue;
      if (field.mapsTo) mapped[field.mapsTo] = v;
    }
    // Lead source: explicit param wins; otherwise infer from a "how did you hear" answer.
    const leadSource = coerceSource(leadSourceInput) || inferSource(data, form) || "website";

    const now = Date.now();
    const contactId = uid();
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
      budget: Number(mapped.budget) || 0,
      notes: String(mapped.notes || "").slice(0, 2000),
      lastTouch: now, createdAt: now,
    };
    db.contacts = [contact, ...(db.contacts || [])];

    const submission: FormSubmission = {
      id: uid(), formId, brandId: form.brandId, data, leadSource, contactId, createdAt: now,
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
  const types = ["text", "email", "phone", "textarea", "select", "number"];
  const maps = ["name", "email", "phone", "budget", "notes", "type"];
  return fields.slice(0, 40).map((f: any) => ({
    id: f?.id ? String(f.id) : uid(),
    label: String(f?.label || "Field").slice(0, 160),
    type: (types.includes(f?.type) ? f.type : "text") as OnboardingField["type"],
    required: Boolean(f?.required),
    options: Array.isArray(f?.options) ? f.options.map((o: any) => String(o).slice(0, 120)).slice(0, 30) : undefined,
    mapsTo: maps.includes(f?.mapsTo) ? f.mapsTo : undefined,
  }));
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
