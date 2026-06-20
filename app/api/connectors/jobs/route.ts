import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireConnectorAccess } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/connectors/jobs?connector_id=…&org_id=…
 * Returns backfill-queue progress for a connector so the UI can show live status.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const connectorId = req.nextUrl.searchParams.get("connector_id");
  const orgId = req.nextUrl.searchParams.get("org_id") ?? undefined;
  if (!connectorId) {
    return NextResponse.json({ error: "connector_id is required" }, { status: 400 });
  }

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
    count("pending"),
    count("running"),
    count("done"),
    count("failed"),
  ]);

  const remaining = pending + running;
  return NextResponse.json({
    pending,
    running,
    done,
    failed,
    remaining,
    total: pending + running + done + failed,
    active: remaining > 0,
  });
}
