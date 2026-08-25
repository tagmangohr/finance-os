import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getBankOverview, getBankOverviewCached, getBankTransactions } from "@/lib/expenses/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** TEMPORARY owner-only Bank-page diagnostic — remove once stable. */
export async function GET(): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const steps: Record<string, unknown> = {};
  const time = async (label: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try { const r = await fn(); steps[label] = { ok: true, ms: Date.now() - t0, info: summarize(r) }; }
    catch (e) { steps[label] = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack?.split("\n").slice(0, 5) : undefined }; }
  };

  const sb = await createServiceClient();
  await time("getBankOverview_uncached", () => getBankOverview(org.id, sb, {}));
  await time("getBankOverviewCached", () => getBankOverviewCached(org.id, { from: undefined, to: undefined }));
  await time("getBankTransactions_page0", () => getBankTransactions(org.id, sb, { page: 0, pageSize: 50 }));

  return NextResponse.json({ org: org.id, steps }, { status: 200 });
}

function summarize(r: unknown): unknown {
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    if (o.totals) return { totals: o.totals, monthly: Array.isArray(o.monthly) ? o.monthly.length : 0, byCategory: Array.isArray(o.byCategory) ? o.byCategory.length : 0 };
    if (Array.isArray(o.rows)) return { rows: o.rows.length, total: o.total };
  }
  return typeof r;
}
