import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { canManageOrg } from "@/lib/org/permissions";
import { generateTempPassword } from "@/lib/org/add-member";

/**
 * POST /api/users/[memberId]/reset-password
 *
 * Admin action: set a fresh one-time password for a member and force them to choose
 * their own on next login (the `must_change_password` flag the dashboard layout
 * enforces). Returns the temp password for the admin to relay — same model as
 * add-member, since no email/SMTP is configured. Because the layout re-reads the
 * user on every render, the forced change also applies to any existing session.
 *
 * Guarded: caller must manage the MEMBER's org (owner/admin). Cannot reset the org
 * owner (they manage their own) or your own account (use Change Password instead).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
): Promise<NextResponse> {
  const { memberId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();

  // Resolve the member, then authorize against THAT member's org.
  const { data: target } = await service
    .from("org_members")
    .select("id, org_id, user_id, invited_email, status")
    .eq("id", memberId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

  if (!(await canManageOrg(service, user.id, target.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (target.status === "revoked") {
    return NextResponse.json({ error: "This member has been removed. Re-add them to restore access." }, { status: 400 });
  }
  if (!target.user_id) {
    return NextResponse.json({ error: "This member doesn't have an account yet." }, { status: 400 });
  }
  if (target.user_id === user.id) {
    return NextResponse.json({ error: "Use Account → Change Password for your own account." }, { status: 400 });
  }

  // Never reset the ORGANISATION OWNER's password from here. Fail CLOSED if the org
  // can't be read (don't risk resetting an owner we couldn't verify).
  const { data: org } = await service
    .from("organizations").select("owner_id").eq("id", target.org_id).maybeSingle();
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });
  if (org.owner_id === target.user_id) {
    return NextResponse.json({ error: "The organisation owner manages their own password." }, { status: 403 });
  }
  // Admins (and the owner) may reset any member, INCLUDING peer admins — an admin is a
  // trusted role that already manages the team, so admin-to-admin reset is allowed.

  // ORG-SCOPED SHARED-ACCOUNT GUARD (cross-org takeover). A person can be an active
  // MEMBER of several shared orgs on ONE login (addOrLinkMember reuses an existing
  // account by email). Resetting hands the actor a working credential for all of them,
  // so only allow it when the actor manages every such org.
  //
  // We intentionally DON'T count an org the person merely OWNS: every user gets a
  // personal org auto-created at signup (their own empty space, not another team's
  // data), so counting owned orgs would block almost every reset. The real risk is
  // shared MEMBERSHIP in another team's org.
  const { data: otherMemberships } = await service
    .from("org_members")
    .select("org_id")
    .eq("user_id", target.user_id)
    .eq("status", "active")
    .neq("org_id", target.org_id);
  for (const m of otherMemberships ?? []) {
    if (!(await canManageOrg(service, user.id, m.org_id as string))) {
      return NextResponse.json({
        error: "This person is also an active member of another organisation you don't manage, so their password can't be reset from here.",
      }, { status: 409 });
    }
  }

  // Set the new temp password + force a change on next login. Read the existing user
  // first and MERGE its metadata so we never wipe full_name; abort if we can't read it
  // (setting metadata blind could replace it).
  const tempPassword = generateTempPassword();
  const { data: existing, error: getErr } = await service.auth.admin.getUserById(target.user_id);
  if (getErr || !existing?.user) {
    return NextResponse.json({ error: "Could not load the member's account." }, { status: 500 });
  }
  const meta = { ...(existing.user.user_metadata ?? {}), must_change_password: true };
  const { error: updErr } = await service.auth.admin.updateUserById(target.user_id, {
    password: tempPassword,
    user_metadata: meta,
  });
  if (updErr) return NextResponse.json({ error: `Could not reset password: ${updErr.message}` }, { status: 500 });

  // Audit (best-effort — never block the reset).
  try {
    await service.from("member_activity").insert({
      org_id: target.org_id,
      actor_user_id: user.id,
      actor_email: user.email ?? null,
      action: "password_reset",
      target_member_id: memberId,
      meta: {},
    });
  } catch { /* member_activity table not present yet — ignore */ }

  return NextResponse.json({ credentials: { email: target.invited_email, password: tempPassword } });
}
