import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";
import { getMetricPrefs, sanitizePrefs } from "@/lib/metrics/prefs";

/** GET /api/metrics/prefs?org_id= — the caller's pinned metrics for an org. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const orgId = req.nextUrl.searchParams.get("org_id");
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });
  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;
  const prefs = await getMetricPrefs(auth.userId, auth.org.id, auth.supabase);
  return NextResponse.json(prefs);
}

/** PUT /api/metrics/prefs — save the caller's pinned metrics + visible count. */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string; pinned?: unknown; visibleCount?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const orgId = body.org_id;
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });
  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;

  const clean = sanitizePrefs(body.pinned, body.visibleCount);
  const { error } = await auth.supabase
    .from("user_metric_prefs")
    .upsert(
      { user_id: auth.userId, org_id: auth.org.id, pinned_metric_keys: clean.pinned, visible_count: clean.visibleCount, updated_at: new Date().toISOString() },
      { onConflict: "user_id,org_id" }
    );

  // A missing table (migration 029 not applied yet) must not fail the request —
  // the client keeps the selection locally and it persists once the table exists.
  if (error) return NextResponse.json({ ...clean, persisted: false, warning: error.message }, { status: 200 });
  return NextResponse.json({ ...clean, persisted: true });
}
