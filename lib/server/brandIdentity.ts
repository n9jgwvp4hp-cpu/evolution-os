import { read } from "@/lib/server/db";
import { listBrandConnections } from "@/lib/server/brandGoogle";
import type { EmailTemplate } from "@/lib/types";

/**
 * Brand identity resolution (Phase 2 #4 + #5).
 *
 * Evolution OS selects the correct email + calendar identity based on the brand.
 * A brand may have its own connected Gmail (its own OAuth) and its own calendar;
 * until that per-brand OAuth is connected (the one credential step), the OS falls
 * back to the primary connected Google account but still stamps the brand's
 * from-name, signature, and templates — so outbound work is brand-correct today
 * and becomes fully isolated the moment a brand account is connected.
 */

export async function resolveBrandEmail(brandId?: string | null) {
  const brand = await read((db) => (db.brands || []).find((b) => b.id === brandId) || null);
  const conn = (await listBrandConnections()).find((c) => c.brandId === brandId) || null;
  const cfg = brand?.email;
  return {
    brandId: brand?.id ?? null,
    brandName: brand?.name ?? null,
    fromName: cfg?.fromName || brand?.name || undefined,
    // The address mail is actually sent from: the brand's own connected Gmail if
    // it has one, otherwise whatever account it currently operates through.
    fromEmail: conn?.connected ? conn.email : (cfg?.connectedEmail || conn?.effectiveEmail || null),
    usingBrandAccount: !!conn?.connected,
    // Which account the OS effectively sends through today: brand | parent | legacy | none.
    effective: conn?.effective ?? "none",
    primaryFallback: !conn?.connected,
    signature: cfg?.signature || "",
    templates: cfg?.templates || [],
  };
}

export async function resolveBrandCalendar(brandId?: string | null) {
  const brand = await read((db) => (db.brands || []).find((b) => b.id === brandId) || null);
  const conn = (await listBrandConnections()).find((c) => c.brandId === brandId) || null;
  return {
    brandId: brand?.id ?? null,
    brandName: brand?.name ?? null,
    // With a brand's own account connected, "primary" is that account's calendar.
    calendarId: brand?.calendar?.calendarId || "primary",
    usingBrandCalendar: !!conn?.connected || !!brand?.calendar?.calendarId,
    effective: conn?.effective ?? "none",
    eventTypes: brand?.calendar?.eventTypes || [],
  };
}

const fill = (s: string, vars: Record<string, string>) =>
  String(s || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));

/** Render an email template with {{token}} substitution + append the signature. */
export function applyEmailTemplate(tpl: EmailTemplate, vars: Record<string, string>, signature = "") {
  const body = fill(tpl.body, vars) + (signature ? `\n\n${fill(signature, vars)}` : "");
  return { subject: fill(tpl.subject, vars), body };
}
