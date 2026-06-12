import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/profile
 * Returns the current user's metadata and their org details.
 */
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, currency, timezone")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    user: {
      id:        user.id,
      email:     user.email ?? "",
      full_name: (user.user_metadata?.full_name as string | undefined) ?? "",
    },
    org: org ?? null,
    is_owner: !!org,
  });
}

/**
 * PATCH /api/profile
 * Body: { full_name?, org_name?, currency?, timezone? }
 *
 * full_name is stored in Supabase auth user metadata.
 * org_* fields update the organizations row (owner-only; RLS enforces this).
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

  // ── Update display name (stored in Supabase auth metadata) ──────────────
  if (full_name !== undefined) {
    const { error } = await supabase.auth.updateUser({ data: { full_name: full_name.trim() } });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // ── Update org details (owner only; RLS rejects non-owners silently) ─────
  const orgUpdates: Record<string, string> = {};
  if (org_name?.trim())  orgUpdates.name     = org_name.trim();
  if (currency?.trim())  orgUpdates.currency = currency.trim().toUpperCase();
  if (timezone?.trim())  orgUpdates.timezone = timezone.trim();

  if (Object.keys(orgUpdates).length > 0) {
    const { error } = await supabase
      .from("organizations")
      .update(orgUpdates)
      .eq("owner_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
