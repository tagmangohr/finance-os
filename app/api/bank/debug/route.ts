import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getBankOverview, getBankOverviewCached } from "@/lib/expenses/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORARY owner-only diagnostic for the Bank page 500. Runs the real code path
 * step by step, catching + reporting the actual error/timing that Vercel logs would
 * show. Remove once the Bank page is stable.
 */
export async function GET(): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const steps: Record<string, unknown> = {};
  const time = async (label: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      steps[label] = { ok: true, ms: Date.now() - t0, sample: summarize(r) };
    } catch (e) {
      steps[label] = { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack?.split("\n").slice(0, 4) : undefined };
    }
  };

  const sb = await createServiceClient();
  const range = { from: undefined as string | undefined, to: undefined as string | undefined };

  // 1) the uncached function directly (isolates query/aggregation from the cache layer)
  await time("getBankOverview_uncached", () => getBankOverview(org.id, sb, range));
  // 2) the cached wrapper (isolates unstable_cache / payload-size issues)
  await time("getBankOverviewCached", () => getBankOverviewCached(org.id, range));

  return NextResponse.json({ org: org.id, steps }, { status: 200 });
}

function summarize(r: unknown): unknown {
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    if (Array.isArray(o.transactions)) {
      return {
        txnCount: (o.transactions as unknown[]).length,
        payloadKB: Math.round(Buffer.byteLength(JSON.stringify(r)) / 1024),
        totals: o.totals,
        monthlyLen: Array.isArray(o.monthly) ? (o.monthly as unknown[]).length : 0,
        byCategoryLen: Array.isArray(o.byCategory) ? (o.byCategory as unknown[]).length : 0,
        byCardLen: Array.isArray(o.byCard) ? (o.byCard as unknown[]).length : 0,
      };
    }
  }
  return typeof r;
}
