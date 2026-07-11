import { NextRequest, NextResponse } from "next/server";
import { listActivity } from "@/lib/server/activity";
import type { ActivityKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET the global activity feed. ?brandId=… scopes it; ?kinds=a,b filters; ?limit=N. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const brandId = sp.get("brandId") || undefined;
  const kinds = (sp.get("kinds") || "").split(",").map((k) => k.trim()).filter(Boolean) as ActivityKind[];
  const limit = Number(sp.get("limit")) || 100;
  const items = await listActivity({ brandId, kinds: kinds.length ? kinds : undefined, limit });
  return NextResponse.json({ ok: true, activity: items });
}
