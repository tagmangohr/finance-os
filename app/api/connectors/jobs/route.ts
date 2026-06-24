import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireConnectorAccess, requireOrgAccess } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

type Progress = {
  pending: number; running: number; done: number; failed: number;
  remaining: number; total: number; active: boolean; percent: number;
};

function toProgress(p: { pending: number; running: number; done: number; failed: number }): Progress {
  const remaining = p.pending + p.running;
  const total = remaining + p.done + p.failed;
  const completed = p.done + p.failed;
  return {
    ...p,
    remaining,
    total,
    active: remaining > 0,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

/**
 * GET /api/connectors/jobs
 *   ?connector_id=…  → progress for one connector (used by the per-sync poll)
 *   ?org_id=…        → progress for EVERY connector in the org, in one call, so the
 *                      connectors page can drive a live progress bar on each card.
 *
 * Org-wide scope counts only jobs from the last 24h, so a fresh backfill's bar
 * fills 0→100% instead of being inflated by long-finished batches.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const connectorId = req.nextUrl.searchParams.get("connector_id");
  const orgId = req.nextUrl.searchParams.get("org_id") ?? undefined;

  // ── Single connector ────────────────────────────────────────────────────────
  if (connectorId) {
    const auth = await requireConnectorAccess(connectorId, { orgId });
    if (isAuthFailure(auth)) return auth.error;

    const count = async (status: string) => {
      const { count } = await auth.supabase
        .from("sync_jobs")
        .select("id", { count: "exact", head: true })
        .eq("connector_id", connectorId)
        .eq("status", status);
      return count ?? 0;
    };
    const [pending, running, done, failed] = await Promise.all([
      count("pending"), count("running"), count("done"), count("failed"),
    ]);
    return NextResponse.json(toProgress({ pending, running, done, failed }));
  }

  // ── Whole org, one call ───────────────────────────────────────────────────────
  if (!orgId) {
    return NextResponse.json({ error: "connector_id or org_id is required" }, { status: 400 });
  }
  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await auth.supabase
    .from("sync_jobs")
    .select("connector_id, status")
    .eq("org_id", auth.org.id)
    .gte("created_at", cutoff);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const acc: Record<string, { pending: number; running: number; done: number; failed: number }> = {};
  for (const row of data ?? []) {
    const id = row.connector_id as string;
    (acc[id] ??= { pending: 0, running: 0, done: 0, failed: 0 });
    const s = row.status as "pending" | "running" | "done" | "failed";
    if (s in acc[id]) acc[id][s]++;
  }

  const connectors: Record<string, Progress> = {};
  for (const [id, p] of Object.entries(acc)) connectors[id] = toProgress(p);
  return NextResponse.json({ connectors });
}
