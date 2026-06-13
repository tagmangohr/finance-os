import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";

/**
 * PATCH /api/users/[memberId]
 * Body: { role?, page_access? }
 * Updates a member's role or page access in the ACTIVE org. Owner/admin only.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse> {
  const { memberId } = await params;

  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!org || !canManageTeam) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  // Service client (authorized above); scoped to the active org so a member of
  // another org can never be touched from here.
  const service = await createServiceClient();
  const { data, error } = await service
    .from("org_members")
    .update(updates)
    .eq("id", memberId)
    .eq("org_id", org.id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: "Member not found" }, { status: 404 });

  return NextResponse.json(data);
}

/**
 * DELETE /api/users/[memberId]
 * Revokes a member's access in the ACTIVE org (soft delete). Owner/admin only.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse> {
  const { memberId } = await params;

  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!org || !canManageTeam) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const service = await createServiceClient();
  const { error } = await service
    .from("org_members")
    .update({ status: "revoked" })
    .eq("id", memberId)
    .eq("org_id", org.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
