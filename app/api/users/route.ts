import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { canManageOrg } from "@/lib/org/permissions";
import { addOrLinkMember } from "@/lib/org/add-member";

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
    .select("id, org_id, invited_email, user_id, role, page_access, payments_search_only, status, created_at")
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
 * Body: { org_id, email, full_name?, role, page_access, payments_search_only }
 * Adds one teammate to a specific org (owner/admin only). The create-or-link work
 * lives in addOrLinkMember, shared with the bulk route.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { org_id?: string; email?: string; full_name?: string; role?: string; page_access?: string[]; payments_search_only?: boolean };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { org: active } = await getActiveOrg();
  const orgId = body.org_id ?? active?.id;
  if (!orgId) return NextResponse.json({ error: "No organisation specified" }, { status: 400 });

  const service = await createServiceClient();
  if (!(await canManageOrg(service, user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden — you don't manage this organisation" }, { status: 403 });
  }

  const result = await addOrLinkMember(service, {
    orgId, actorUserId: user.id, actorEmail: user.email ?? null,
    email: body.email ?? "", full_name: body.full_name, role: body.role,
    page_access: body.page_access, payments_search_only: body.payments_search_only,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    { ...result.member, full_name: result.full_name, created: result.created, credentials: result.credentials },
    { status: result.status }
  );
}
