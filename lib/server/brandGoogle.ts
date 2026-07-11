import { mutate, read, type GoogleTokens } from "@/lib/server/db";
import { refreshGoogleTokens } from "@/lib/server/google";

/**
 * Per-brand Google (Gmail + Calendar) connections.
 *
 * Each brand can connect its OWN Google account; tokens are stored separately by
 * brandId in `db.brandGoogle`. The existing single connection is migrated into the
 * UW Equity (parent) slot by default, so nothing that worked before breaks.
 *
 * Resolution order for a brand's access token: the brand's own connection →
 * the parent holding company (UW Equity) → the legacy/primary token. This means
 * a subsidiary that hasn't connected its own account still operates via the
 * portfolio account until it does, and the moment it connects, it switches over.
 */

/* ---------------- storage ---------------- */
export async function getBrandTokens(brandId: string): Promise<GoogleTokens | null> {
  return read((db) => db.brandGoogle?.[brandId] ?? null);
}
export async function saveBrandTokens(brandId: string, tokens: GoogleTokens): Promise<void> {
  await mutate((db) => {
    db.brandGoogle = { ...(db.brandGoogle || {}), [brandId]: tokens };
    // Keep the legacy primary in sync when the parent connects, for back-compat
    // with non-mission callers (event engine, health checks).
    const parent = (db.brands || []).find((b) => b.isParent);
    if (parent && parent.id === brandId) db.google = tokens;
  });
}
export async function clearBrandTokens(brandId: string): Promise<void> {
  await mutate((db) => {
    if (db.brandGoogle) delete db.brandGoogle[brandId];
    const parent = (db.brands || []).find((b) => b.isParent);
    if (parent && parent.id === brandId) db.google = null;
  });
}

/* ---------------- legacy → UW Equity migration ---------------- */
/** Move the existing single connection into the UW Equity brand's slot (once). */
export async function migrateLegacyToParent(): Promise<void> {
  const needed = await read((db) => {
    const parent = (db.brands || []).find((b) => b.isParent);
    if (!parent || !db.google) return null;
    if (db.brandGoogle?.[parent.id]) return null; // already migrated
    return parent.id;
  });
  if (!needed) return;
  await mutate((db) => {
    const parent = (db.brands || []).find((b) => b.isParent);
    if (!parent || !db.google) return;
    if (db.brandGoogle?.[parent.id]) return;
    db.brandGoogle = { ...(db.brandGoogle || {}), [parent.id]: db.google };
  });
}

/* ---------------- resolution ---------------- */
async function parentId(): Promise<string | null> {
  return read((db) => (db.brands || []).find((b) => b.isParent)?.id ?? null);
}

/** Which tokens a brand resolves to, and via which source. */
async function resolveTokens(brandId: string): Promise<{ tokens: GoogleTokens; source: "brand" | "parent" | "legacy"; ownerBrandId: string | null } | null> {
  await migrateLegacyToParent();
  const own = await getBrandTokens(brandId);
  if (own) return { tokens: own, source: "brand", ownerBrandId: brandId };
  const pid = await parentId();
  if (pid && pid !== brandId) {
    const pt = await getBrandTokens(pid);
    if (pt) return { tokens: pt, source: "parent", ownerBrandId: pid };
  }
  const legacy = await read((db) => db.google);
  if (legacy) return { tokens: legacy, source: "legacy", ownerBrandId: pid };
  return null;
}

// Per-brand single-flight refresh guards (avoid concurrent refresh races).
const refreshing: Record<string, Promise<GoogleTokens>> = {};

/** Valid access token for a brand, refreshing + persisting under the owning slot. */
export async function getBrandAccessToken(brandId: string): Promise<string> {
  const resolved = await resolveTokens(brandId);
  if (!resolved) throw new Error("Google is not connected for this brand.");
  const { tokens, source, ownerBrandId } = resolved;
  if (Date.now() <= tokens.expiry - 60_000) return tokens.access_token;

  const key = ownerBrandId || "__legacy__";
  if (!refreshing[key]) {
    refreshing[key] = (async () => {
      const next = await refreshGoogleTokens(tokens);
      if (source === "legacy" || !ownerBrandId) {
        await mutate((db) => { db.google = next; });
      } else {
        await saveBrandTokens(ownerBrandId, next);
      }
      return next;
    })().finally(() => { delete refreshing[key]; });
  }
  return (await refreshing[key]).access_token;
}

/* ---------------- status (for the Connections UI) ---------------- */
export type BrandConnectionStatus = {
  brandId: string;
  name: string;
  isParent: boolean;
  connected: boolean;        // has its OWN connection
  email: string | null;      // its own account email
  effective: "brand" | "parent" | "legacy" | "none"; // what it actually uses today
  effectiveEmail: string | null;
};

export async function listBrandConnections(): Promise<BrandConnectionStatus[]> {
  await migrateLegacyToParent();
  return read((db) => {
    const brands = db.brands || [];
    const pid = brands.find((b) => b.isParent)?.id ?? null;
    const bg = db.brandGoogle || {};
    return brands.map((b) => {
      const own = bg[b.id] || null;
      let effective: BrandConnectionStatus["effective"] = "none";
      let effTokens: GoogleTokens | null = null;
      if (own) { effective = "brand"; effTokens = own; }
      else if (pid && bg[pid]) { effective = "parent"; effTokens = bg[pid]; }
      else if (db.google) { effective = "legacy"; effTokens = db.google; }
      return {
        brandId: b.id, name: b.name, isParent: b.isParent,
        connected: !!own, email: own?.email ?? null,
        effective, effectiveEmail: effTokens?.email ?? null,
      };
    });
  });
}
