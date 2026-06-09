import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/users/[memberId]
 * Body: { role?, page_access? }
 * Updates a member's role or page access.  Owner-only.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse> {
  const { memberId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden — owner only" }, { status: 403 });

  let body: { role?: string; page_access?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.role === "admin" || body.role === "viewer") updates.role = body.role;
  if (Array.isArray(body.page_access)) updates.page_access = body.page_access;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("org_members")
    .update(updates)
    .eq("id", memberId)
    .eq("org_id", org.id)  // scoped to caller's org — RLS also enforces this
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: "Member not found" }, { status: 404 });

  return NextResponse.json(data);
}

/**
 * DELETE /api/users/[memberId]
 * Revokes a member's access.  Owner-only.
 * Sets status = 'revoked' (soft delete so the email can be re-invited later).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse> {
  const { memberId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden — owner only" }, { status: 403 });

  const { error } = await supabase
    .from("org_members")
    .update({ status: "revoked" })
    .eq("id", memberId)
    .eq("org_id", org.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
