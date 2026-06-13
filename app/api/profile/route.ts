import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";

/**
 * GET /api/profile
 * Returns the current user's metadata and the ACTIVE org's details.
 */
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { org: active } = await getActiveOrg();

  let org = null;
  if (active) {
    const { data } = await supabase
      .from("organizations")
      .select("id, name, slug, currency, timezone")
      .eq("id", active.id)
      .maybeSingle();
    org = data ?? null;
  }

  return NextResponse.json({
    user: {
      id:        user.id,
      email:     user.email ?? "",
      full_name: (user.user_metadata?.full_name as string | undefined) ?? "",
    },
    org,
    is_owner: active?.role === "owner",
  });
}

/**
 * PATCH /api/profile
 * Body: { full_name?, org_name?, currency?, timezone? }
 *
 * full_name → Supabase auth metadata (always allowed for the user themselves).
 * org_* fields → update the ACTIVE org (owner/admin only).
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { full_name?: string; org_name?: string; currency?: string; timezone?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { full_name, org_name, currency, timezone } = body;

  // ── Display name (the user's own auth metadata) ──────────────────────────
  if (full_name !== undefined) {
    const { error } = await supabase.auth.updateUser({ data: { full_name: full_name.trim() } });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // ── Org details — only the ACTIVE org, owner/admin only ──────────────────
  const orgUpdates: Record<string, string> = {};
  if (org_name?.trim())  orgUpdates.name     = org_name.trim();
  if (currency?.trim())  orgUpdates.currency = currency.trim().toUpperCase();
  if (timezone?.trim())  orgUpdates.timezone = timezone.trim();

  if (Object.keys(orgUpdates).length > 0) {
    const { org: active, canManageTeam } = await getActiveOrg();
    if (!active || !canManageTeam) {
      return NextResponse.json(
        { error: "Only an owner or admin can edit organisation settings." },
        { status: 403 }
      );
    }
    // Service client so non-owner admins can update too (RLS is owner-only).
    const service = await createServiceClient();
    const { error } = await service
      .from("organizations")
      .update(orgUpdates)
      .eq("id", active.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
