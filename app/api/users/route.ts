import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { canManageOrg } from "@/lib/org/permissions";

const ROLES = ["admin", "manager", "viewer"] as const;
type Role = (typeof ROLES)[number];

/**
 * GET /api/users?org_id=...
 * Members of the given org (defaults to the active org). Owner/admin of that org only.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requested = new URL(req.url).searchParams.get("org_id");
  const { org: active } = await getActiveOrg();
  const orgId = requested ?? active?.id;
  if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 400 });

  const serviceClient = await createServiceClient();
  if (!(await canManageOrg(serviceClient, user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: members, error } = await serviceClient
    .from("org_members")
    .select("id, org_id, invited_email, user_id, role, page_access, status, created_at")
    .eq("org_id", orgId)
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
 * Body: { org_id, email, role: "admin"|"manager"|"viewer", page_access: string[] }
 * Invites a member to a SPECIFIC org. Owner/admin of that org only.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { org_id?: string; email?: string; role?: string; page_access?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Default to the active org when none is specified (backwards compatible).
  const { org: active } = await getActiveOrg();
  const orgId = body.org_id ?? active?.id;
  if (!orgId) return NextResponse.json({ error: "No organisation specified" }, { status: 400 });

  const service = await createServiceClient();
  if (!(await canManageOrg(service, user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden — you don't manage this organisation" }, { status: 403 });
  }

  const email       = body.email?.trim().toLowerCase();
  const role: Role  = (ROLES as readonly string[]).includes(body.role ?? "") ? (body.role as Role) : "viewer";
  const page_access = Array.isArray(body.page_access) ? body.page_access : ["dashboard", "revenue", "cashflow", "collections"];

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (email === user.email?.toLowerCase()) {
    return NextResponse.json({ error: "You cannot invite yourself" }, { status: 400 });
  }

  const { data: existing } = await service
    .from("org_members")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("invited_email", email)
    .maybeSingle();

  if (existing) {
    if (existing.status === "revoked") {
      const { data: updated, error } = await service
        .from("org_members")
        .update({ role, page_access, status: "pending", user_id: null })
        .eq("id", existing.id)
        .select("id, org_id, invited_email, user_id, role, page_access, status, created_at")
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ...updated, full_name: null });
    }
    return NextResponse.json({ error: "This email has already been invited to this organisation" }, { status: 409 });
  }

  const { data: member, error } = await service
    .from("org_members")
    .insert({
      org_id:        orgId,
      invited_email: email,
      role,
      page_access,
      status:        "pending",
      invited_by:    user.id,
    })
    .select("id, org_id, invited_email, user_id, role, page_access, status, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ...member, full_name: null }, { status: 201 });
}
