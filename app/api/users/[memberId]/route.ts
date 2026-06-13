import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { canManageOrg } from "@/lib/org/permissions";

const ROLES = ["admin", "manager", "viewer"] as const;

/**
 * PATCH /api/users/[memberId]
 * Body: { role?, page_access? }
 * Updates a member's role/pages. Caller must manage the MEMBER's org.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse> {
  const { memberId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();

  // Resolve the member's org, then authorize against THAT org.
  const { data: target } = await service
    .from("org_members")
    .select("id, org_id")
    .eq("id", memberId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  if (!(await canManageOrg(service, user.id, target.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { role?: string; page_access?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if ((ROLES as readonly string[]).includes(body.role ?? "")) updates.role = body.role;
  if (Array.isArray(body.page_access)) updates.page_access = body.page_access;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await service
    .from("org_members")
    .update(updates)
    .eq("id", memberId)
    .select("id, org_id, invited_email, user_id, role, page_access, status, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: "Member not found" }, { status: 404 });

  // Preserve display name shape the client expects.
  let full_name: string | null = null;
  if (data.user_id) {
    const { data: authUser } = await service.auth.admin.getUserById(data.user_id);
    full_name = (authUser?.user?.user_metadata?.full_name as string | undefined) ?? null;
  }
  return NextResponse.json({ ...data, full_name });
}

/**
 * DELETE /api/users/[memberId]
 * Revokes a member's access (soft delete). Caller must manage the MEMBER's org.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse> {
  const { memberId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();

  const { data: target } = await service
    .from("org_members")
    .select("id, org_id")
    .eq("id", memberId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  if (!(await canManageOrg(service, user.id, target.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await service
    .from("org_members")
    .update({ status: "revoked" })
    .eq("id", memberId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
