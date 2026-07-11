import { mutate, read, type GoogleTokens } from "@/lib/server/db";
import { refreshGoogleTokens } from "@/lib/server/google";

/**
 * Per-brand Google (Gmail + Calendar) connections, with strict PERSONAL/BUSINESS
 * isolation.
 *
 * Account types (Brand.kind):
 *   • personal — a fully separate account, NEVER used for business operations.
 *   • holding  — the parent company (UW Equity).
 *   • brand    — a business subsidiary (Prism44, Quality Management, …).
 *
 * Token resolution:
 *   • personal brand → its OWN connection only. Nothing else ever borrows it.
 *   • business brand → its OWN connection → the holding company (UW Equity) if
 *     that has its own connection → otherwise NONE. It never falls back to the
 *     personal account or a legacy token.
 *
 * The previously-connected account is personal, so it is migrated (once) into the
 * Personal brand and removed from the holding slot + the legacy field, so no
 * business mission can act through it.
 */

/* ---------------- storage ---------------- */
export async function getBrandTokens(brandId: string): Promise<GoogleTokens | null> {
  return read((db) => db.brandGoogle?.[brandId] ?? null);
}
export async function saveBrandTokens(brandId: string, tokens: GoogleTokens): Promise<void> {
  await mutate((db) => {
    db.brandGoogle = { ...(db.brandGoogle || {}), [brandId]: tokens };
  });
}
export async function clearBrandTokens(brandId: string): Promise<void> {
  await mutate((db) => {
    if (db.brandGoogle) delete db.brandGoogle[brandId];
  });
}

/* ---------------- one-time personal migration ---------------- */
/**
 * The connected account is personal. Move it into the Personal brand's slot and
 * strip it from the holding slot + legacy field so business operations can never
 * use it. Guarded by settings.personalMigrationDone — runs once.
 */
export async function ensurePersonalMigration(): Promise<void> {
  const done = await read((db) => db.settings?.personalMigrationDone === true);
  if (done) return;
  // Guarantee the Personal account (+ account kinds) exist before relocating the token.
  const { ensureBrandsSeeded } = await import("@/lib/server/brands");
  await ensureBrandsSeeded();
  await mutate((db) => {
    if (db.settings?.personalMigrationDone) return;
    const brands = db.brands || [];
    const personal = brands.find((b) => b.kind === "personal");
    if (!personal) return; // Personal not seeded yet — retry on a later pass
    const holding = brands.find((b) => b.isParent);
    const bg = db.brandGoogle || {};
    // The connected account lives in the holding slot (from the earlier migration)
    // or the legacy field. Relocate it to Personal.
    const token = bg[personal.id] || (holding ? bg[holding.id] : null) || db.google || null;
    if (token && !bg[personal.id]) bg[personal.id] = token;
    if (holding) delete bg[holding.id]; // business must not use the personal account
    db.brandGoogle = bg;
    db.google = null; // remove the legacy/business fallback entirely
    db.settings = { ...(db.settings || { activeBrandId: null }), personalMigrationDone: true };
  });
}

/* ---------------- resolution ---------------- */
type Resolved = { tokens: GoogleTokens; source: "brand" | "parent"; ownerBrandId: string } | null;

async function resolveTokens(brandId: string): Promise<Resolved> {
  await ensurePersonalMigration();
  return read((db) => {
    const brands = db.brands || [];
    const bg = db.brandGoogle || {};
    const brand = brands.find((b) => b.id === brandId);
    const own = bg[brandId];
    if (own) return { tokens: own, source: "brand", ownerBrandId: brandId };
    // Personal (and unknown) brands never borrow another account.
    if (!brand || brand.kind === "personal") return null;
    // Business brand: fall back to the holding company ONLY if it has its own connection.
    const holding = brands.find((b) => b.isParent);
    if (holding && holding.id !== brandId && bg[holding.id]) {
      return { tokens: bg[holding.id], source: "parent", ownerBrandId: holding.id };
    }
    return null;
  });
}

const refreshing: Record<string, Promise<GoogleTokens>> = {};

/** Valid access token for a brand, honoring personal/business isolation. */
export async function getBrandAccessToken(brandId: string): Promise<string> {
  const resolved = await resolveTokens(brandId);
  if (!resolved) throw new Error("Google is not connected for this brand.");
  const { tokens, ownerBrandId } = resolved;
  if (Date.now() <= tokens.expiry - 60_000) return tokens.access_token;

  if (!refreshing[ownerBrandId]) {
    refreshing[ownerBrandId] = (async () => {
      const next = await refreshGoogleTokens(tokens);
      await saveBrandTokens(ownerBrandId, next);
      return next;
    })().finally(() => { delete refreshing[ownerBrandId]; });
  }
  return (await refreshing[ownerBrandId]).access_token;
}

/* ---------------- status (for the Connections / Brand Settings UI) ---------------- */
export type BrandConnectionStatus = {
  brandId: string;
  name: string;
  kind: "personal" | "holding" | "brand";
  isParent: boolean;
  connected: boolean;        // has its OWN connection
  email: string | null;      // its own account email
  effective: "brand" | "parent" | "none"; // what it actually uses today
  effectiveEmail: string | null;
};

export async function listBrandConnections(): Promise<BrandConnectionStatus[]> {
  await ensurePersonalMigration();
  return read((db) => {
    const brands = db.brands || [];
    const holdingId = brands.find((b) => b.isParent)?.id ?? null;
    const bg = db.brandGoogle || {};
    return brands.map((b) => {
      const own = bg[b.id] || null;
      let effective: BrandConnectionStatus["effective"] = "none";
      let effTokens: GoogleTokens | null = null;
      if (own) { effective = "brand"; effTokens = own; }
      else if (b.kind !== "personal" && holdingId && holdingId !== b.id && bg[holdingId]) {
        effective = "parent"; effTokens = bg[holdingId];
      }
      return {
        brandId: b.id, name: b.name, kind: b.kind, isParent: b.isParent,
        connected: !!own, email: own?.email ?? null,
        effective, effectiveEmail: effTokens?.email ?? null,
      };
    });
  });
}
