import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";

/**
 * GET /api/users
 * Returns all members of the ACTIVE org. Owner/admin of that org only.
 */
export async function GET(): Promise<NextResponse> {
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!org || !canManageTeam) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Service client so non-owner admins can read the member list (and auth profiles).
  const serviceClient = await createServiceClient();
  const { data: members, error } = await serviceClient
    .from("org_members")
    .select("id, invited_email, user_id, role, page_access, status, created_at")
    .eq("org_id", org.id)
    .neq("status", "revoked")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const enriched = await Promise.all((members ?? []).map(async (m) => {
    if (!m.user_id) return { ...m, full_name: null };
    const { data: authUser } = await serviceClient.auth.admin.getUserById(m.user_id);
    return {
      ...m,
      full_name: (authUser?.user?.user_metadata?.full_name as string | undefined) ?? null,
    };
  }));

  return NextResponse.json(enriched);
}

/**
 * POST /api/users
 * Body: { email: string; role: "admin" | "viewer"; page_access: string[] }
 * Invites a member to the ACTIVE org. Owner/admin of that org only.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { org, canManageTeam } = await getActiveOrg();
  if (!org || !canManageTeam) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string; role?: string; page_access?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email       = body.email?.trim().toLowerCase();
  const role        = body.role === "admin" ? "admin" : "viewer";
  const page_access = Array.isArray(body.page_access) ? body.page_access : ["dashboard", "revenue", "cashflow", "collections"];

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (email === user.email?.toLowerCase()) {
    return NextResponse.json({ error: "You cannot invite yourself" }, { status: 400 });
  }

  // Service client: writes bypass RLS (which only lets the OWNER manage members),
  // so authorized admins can invite too. Authorization is already enforced above.
  const service = await createServiceClient();

  const { data: existing } = await service
    .from("org_members")
    .select("id, status")
    .eq("org_id", org.id)
    .eq("invited_email", email)
    .maybeSingle();

  if (existing) {
    if (existing.status === "revoked") {
      const { data: updated, error } = await service
        .from("org_members")
        .update({ role, page_access, status: "pending", user_id: null })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: "This email has already been invited" }, { status: 409 });
  }

  const { data: member, error } = await service
    .from("org_members")
    .insert({
      org_id:        org.id,
      invited_email: email,
      role,
      page_access,
      status:        "pending",
      invited_by:    user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(member, { status: 201 });
}
