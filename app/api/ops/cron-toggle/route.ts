import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getOrgId } from "@/lib/data";
import { canManageOrg } from "@/lib/org/permissions";
import { setCronEnabled } from "@/lib/ops/cron-settings";
import { TOGGLEABLE_JOBS } from "@/lib/ops/cron-registry";

export const runtime = "nodejs";

/**
 * POST /api/ops/cron-toggle — switch a scheduled cron On/Off (cron_settings, migration
 * 129). Body: { jobName: string, enabled: boolean }.
 *
 * These crons are GLOBAL to the deployment (one set serves every org), so turning one off
 * pauses it platform-wide. Gated to OWNER/ADMIN of the caller's active org (canManageOrg —
 * managers/viewers are refused), matching the "Owner + Admins" product decision. The
 * job name is validated against the known cron set so an arbitrary row can't be written.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await getOrgId();
  if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const service = await createServiceClient();
  if (!(await canManageOrg(service, user.id, orgId))) {
    return NextResponse.json({ error: "Only an owner or admin can change scheduled jobs" }, { status: 403 });
  }

  let body: { jobName?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const jobName = typeof body.jobName === "string" ? body.jobName : "";
  if (!TOGGLEABLE_JOBS.has(jobName)) {
    return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  try {
    await setCronEnabled(service, jobName, body.enabled, user.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, jobName, enabled: body.enabled });
}
