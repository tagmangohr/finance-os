import crypto from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

const ROLES = ["admin", "manager", "viewer"] as const;
export type Role = (typeof ROLES)[number];

const MEMBER_COLS =
  "id, org_id, invited_email, user_id, role, page_access, payments_search_only, status, created_at";

/** Strong, readable temporary password (mixed case, digits, symbol — no ambiguous chars). */
export function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Find an existing Supabase auth user by email (case-insensitive). Paginates a
 *  few pages — team rosters are small, so this stays cheap. Returns null if none. */
export async function findAuthUserByEmail(service: ServiceClient, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 1000) break;
  }
  return null;
}

export type AddMemberInput = {
  orgId: string;
  actorUserId: string;
  actorEmail: string | null;
  email: string;
  full_name?: string | null;
  role?: string;
  page_access?: string[];
  payments_search_only?: boolean;
};

export type MemberRow = {
  id: string; org_id: string; invited_email: string; user_id: string | null;
  role: Role; page_access: string[]; payments_search_only: boolean;
  status: "pending" | "active" | "revoked"; created_at: string;
};

export type AddMemberResult =
  | { ok: true; status: number; member: MemberRow; full_name: string | null; created: boolean; credentials: { email: string; password: string } | null }
  | { ok: false; status: number; error: string };

/**
 * Create-or-link a teammate into ONE org as an ACTIVE member. Caller must have
 * ALREADY authorized (canManageOrg) for orgId — this helper does the work only.
 * Shared by POST /api/users (single) and POST /api/users/bulk (batch), so both
 * paths behave identically: new email → confirmed account + one-time temp password;
 * existing email → linked with their existing login (no new password).
 */
export async function addOrLinkMember(service: ServiceClient, input: AddMemberInput): Promise<AddMemberResult> {
  const email = input.email?.trim().toLowerCase();
  const fullName = input.full_name?.trim() || null;
  const role: Role = (ROLES as readonly string[]).includes(input.role ?? "") ? (input.role as Role) : "viewer";
  const page_access = Array.isArray(input.page_access) ? input.page_access : ["dashboard", "revenue", "cashflow", "collections"];
  const payments_search_only =
    role !== "admin" && page_access.includes("data") && input.payments_search_only === true;

  if (!email || !email.includes("@")) return { ok: false, status: 400, error: "Valid email is required" };
  if (email === input.actorEmail?.toLowerCase()) return { ok: false, status: 400, error: "You cannot add yourself" };

  // Already an active/pending member of THIS org?
  const { data: existing } = await service
    .from("org_members").select("id, status").eq("org_id", input.orgId).eq("invited_email", email).maybeSingle();
  if (existing && existing.status !== "revoked") {
    return { ok: false, status: 409, error: "Already a member of this organisation" };
  }

  // Reuse an existing auth account if present; else create one.
  let userId = await findAuthUserByEmail(service, email);
  let tempPassword: string | null = null;
  if (!userId) {
    tempPassword = generateTempPassword();
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
      user_metadata: { full_name: fullName, must_change_password: true },
    });
    if (createErr || !created?.user) {
      return { ok: false, status: 500, error: `Could not create account: ${createErr?.message ?? "unknown error"}` };
    }
    userId = created.user.id;
  }

  const memberFields = {
    org_id: input.orgId, user_id: userId, invited_email: email,
    role, page_access, payments_search_only, status: "active" as const, invited_by: input.actorUserId,
  };
  const { data: member, error } = existing
    ? await service.from("org_members").update(memberFields).eq("id", existing.id).select(MEMBER_COLS).single()
    : await service.from("org_members").insert(memberFields).select(MEMBER_COLS).single();

  if (error || !member) return { ok: false, status: 500, error: error?.message ?? "Insert failed" };

  // Audit (best-effort).
  try {
    await service.from("member_activity").insert({
      org_id: input.orgId, actor_user_id: input.actorUserId, actor_email: input.actorEmail,
      action: "member_added", target_member_id: member.id,
      meta: { email, role, page_access, payments_search_only },
    });
  } catch { /* member_activity table not present yet — ignore */ }

  return {
    ok: true,
    status: existing ? 200 : 201,
    member: member as MemberRow,
    full_name: fullName,
    created: tempPassword !== null,
    credentials: tempPassword ? { email, password: tempPassword } : null,
  };
}
