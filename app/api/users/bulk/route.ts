import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { canManageOrg } from "@/lib/org/permissions";
import { addOrLinkMember } from "@/lib/org/add-member";

export const maxDuration = 60;

/**
 * POST /api/users/bulk
 * Body: { org_id, users: [{ email, full_name?, role, page_access, payments_search_only }] }
 * Adds many teammates to ONE org in a single request (owner/admin only). Each user
 * is processed independently via addOrLinkMember, so one bad row (e.g. already a
 * member) never fails the rest. Returns a per-email result incl. one-time creds.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    org_id?: string;
    users?: { email?: string; full_name?: string | null; role?: string; page_access?: string[]; payments_search_only?: boolean }[];
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { org: active } = await getActiveOrg();
  const orgId = body.org_id ?? active?.id;
  if (!orgId) return NextResponse.json({ error: "No organisation specified" }, { status: 400 });

  const users = Array.isArray(body.users) ? body.users : [];
  if (users.length === 0) return NextResponse.json({ error: "No users provided" }, { status: 400 });
  if (users.length > 100) return NextResponse.json({ error: "Too many users in one batch (max 100)" }, { status: 400 });

  const service = await createServiceClient();
  if (!(await canManageOrg(service, user.id, orgId))) {
    return NextResponse.json({ error: "Forbidden — you don't manage this organisation" }, { status: 403 });
  }

  const results: {
    email: string; ok: boolean; created?: boolean;
    credentials?: { email: string; password: string } | null;
    member?: unknown; full_name?: string | null; error?: string;
  }[] = [];

  // Sequential: admin.createUser + listUsers are rate-sensitive and rosters are
  // small, so a simple loop is safe and keeps per-row errors isolated.
  for (const u of users) {
    const email = (u.email ?? "").trim();
    if (!email) { results.push({ email: "", ok: false, error: "Empty email" }); continue; }
    const r = await addOrLinkMember(service, {
      orgId, actorUserId: user.id, actorEmail: user.email ?? null,
      email, full_name: u.full_name, role: u.role,
      page_access: u.page_access, payments_search_only: u.payments_search_only,
    });
    if (r.ok) {
      results.push({ email, ok: true, created: r.created, credentials: r.credentials, member: { ...r.member, full_name: r.full_name } });
    } else {
      results.push({ email, ok: false, error: r.error });
    }
  }

  const added = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, added, failed: results.length - added, results });
}

/**
 * DELETE /api/users/bulk
 * Body: { member_ids: string[] }
 * Revokes many members at once (soft delete). Each member is authorized against
 * ITS OWN org — a caller who manages only some of the orgs revokes only those.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { member_ids?: string[] };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.member_ids) ? [...new Set(body.member_ids.filter((x) => typeof x === "string"))] : [];
  if (ids.length === 0) return NextResponse.json({ error: "No member_ids provided" }, { status: 400 });

  const service = await createServiceClient();

  const { data: targets, error: readErr } = await service
    .from("org_members").select("id, org_id, invited_email").in("id", ids);
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  // Authorize per distinct org once.
  const orgIds = [...new Set((targets ?? []).map((t) => t.org_id))];
  const manageable = new Set<string>();
  for (const oid of orgIds) if (await canManageOrg(service, user.id, oid)) manageable.add(oid);

  const revoked: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const t of targets ?? []) {
    if (!manageable.has(t.org_id)) { failed.push({ id: t.id, error: "Forbidden" }); continue; }
    const { error } = await service.from("org_members").update({ status: "revoked" }).eq("id", t.id);
    if (error) { failed.push({ id: t.id, error: error.message }); continue; }
    revoked.push(t.id);
    try {
      await service.from("member_activity").insert({
        org_id: t.org_id, actor_user_id: user.id, actor_email: user.email ?? null,
        action: "member_removed", target_member_id: t.id, meta: {},
      });
    } catch { /* member_activity not present — ignore */ }
  }

  // ids that matched no row at all.
  const foundIds = new Set((targets ?? []).map((t) => t.id));
  for (const id of ids) if (!foundIds.has(id)) failed.push({ id, error: "Not found" });

  return NextResponse.json({ ok: true, revoked, failed });
}
