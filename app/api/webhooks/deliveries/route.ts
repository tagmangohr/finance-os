import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS = "id, endpoint_id, event_id, transaction_id, event_type, status, attempts, response_code, last_error, delivered_at, next_attempt_at, created_at";

async function manageCtx() {
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId || !org) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), org: null };
  if (!canManageTeam) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), org: null };
  return { error: null, org };
}

// GET → recent deliveries for this org (newest first).
export async function GET(): Promise<NextResponse> {
  const ctx = await manageCtx();
  if (ctx.error) return ctx.error;
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("webhook_deliveries")
    .select(COLS)
    .eq("org_id", ctx.org!.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ deliveries: [] });
  return NextResponse.json({ deliveries: data ?? [] });
}

// POST ?id= → re-queue a delivery (fresh retry budget), picked up by the next cron run.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await manageCtx();
  if (ctx.error) return ctx.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("webhook_deliveries")
    .update({ status: "pending", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
    .eq("id", id)
    .eq("org_id", ctx.org!.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
