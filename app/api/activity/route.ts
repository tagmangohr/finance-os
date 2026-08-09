import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { canManageOrg } from "@/lib/org/permissions";

// Actions a CLIENT is allowed to self-report. Sensitive events (permission
// changes, member add/remove) are written server-side only, never from here.
const CLIENT_ACTIONS = ["search", "export"] as const;

/**
 * POST /api/activity  — record one activity event for the CURRENT user.
 * Body: { org_id, action: "search" | "export", meta?: object }
 * The caller must be an active member (or owner) of the org.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { org_id?: string; action?: string; meta?: Record<string, unknown> };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orgId  = body.org_id;
  const action = body.action ?? "";
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });
  if (!(CLIENT_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const service = await createServiceClient();

  // Membership check: owner of the org, or an active member of it.
  const { data: org } = await service.from("organizations").select("owner_id").eq("id", orgId).maybeSingle();
  let allowed = org?.owner_id === user.id;
  if (!allowed) {
    const { data: m } = await service
      .from("org_members")
      .select("id").eq("org_id", orgId).eq("user_id", user.id).eq("status", "active").maybeSingle();
    allowed = !!m;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await service.from("member_activity").insert({
      org_id: orgId,
      actor_user_id: user.id,
      actor_email: user.email ?? null,
      action,
      meta: body.meta ?? {},
    });
  } catch { /* table not present yet — ignore so the app never breaks */ }

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/activity?org_id=&user_id=  — activity for one member (admin only).
 * Returns { lastSignInAt, events } where events are actions the member performed
 * (searches/exports) plus permission changes targeting them.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const orgId   = searchParams.get("org_id");
  const userId  = searchParams.get("user_id");   // the MEMBER's auth user id (may be null if never logged in)
  const memberId = searchParams.get("member_id"); // the org_members row id
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

  const service = await createServiceClient();
  if (!(await canManageOrg(service, user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Last login is free from Supabase auth.
  let lastSignInAt: string | null = null;
  if (userId) {
    try {
      const { data: authUser } = await service.auth.admin.getUserById(userId);
      lastSignInAt = authUser?.user?.last_sign_in_at ?? null;
    } catch { /* ignore */ }
  }

  // Events: things this member did (actor) + permission changes done to them (target).
  let events: unknown[] = [];
  try {
    const ors: string[] = [];
    if (userId)   ors.push(`actor_user_id.eq.${userId}`);
    if (memberId) ors.push(`target_member_id.eq.${memberId}`);
    let q = service
      .from("member_activity")
      .select("id, action, actor_email, meta, created_at, target_member_id")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (ors.length) q = q.or(ors.join(","));
    const { data } = await q;
    events = data ?? [];
  } catch { /* table not present yet */ }

  return NextResponse.json({ lastSignInAt, events });
}
