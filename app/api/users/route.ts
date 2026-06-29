import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { canManageOrg } from "@/lib/org/permissions";

const ROLES = ["admin", "manager", "viewer"] as const;
type Role = (typeof ROLES)[number];

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/** Strong, readable temporary password (mixed case, digits, symbol — no ambiguous chars). */
function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  // Guarantee at least one of each class, then fill to length 14.
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));
  // Fisher–Yates shuffle with a CSPRNG so the guaranteed chars aren't positional.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Find an existing Supabase auth user by email (case-insensitive). Paginates a
 *  few pages — team rosters are small, so this stays cheap. Returns null if none. */
async function findAuthUserByEmail(service: ServiceClient, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 1000) break; // last page
  }
  return null;
}

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
 * Body: { org_id, email, full_name?, role: "admin"|"manager"|"viewer", page_access: string[] }
 *
 * Creates a real, ready-to-use account for a teammate and adds them to a SPECIFIC
 * org as an ACTIVE member. Owner/admin of that org only.
 *  • New email  → generates a temp password, creates a confirmed auth user
 *    (must_change_password=true), and returns the credentials ONCE so the admin
 *    can share them. The teammate is forced to set their own password on first login.
 *  • Existing email → links that account to the org (no new password); returns
 *    created:false so the UI explains they were added with their existing login.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { org_id?: string; email?: string; full_name?: string; role?: string; page_access?: string[] };
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
  const fullName    = body.full_name?.trim() || null;
  const role: Role  = (ROLES as readonly string[]).includes(body.role ?? "") ? (body.role as Role) : "viewer";
  const page_access = Array.isArray(body.page_access) ? body.page_access : ["dashboard", "revenue", "cashflow", "collections"];

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (email === user.email?.toLowerCase()) {
    return NextResponse.json({ error: "You cannot add yourself" }, { status: 400 });
  }

  // Already an active/pending member of THIS org?
  const { data: existing } = await service
    .from("org_members")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("invited_email", email)
    .maybeSingle();
  if (existing && existing.status !== "revoked") {
    return NextResponse.json({ error: "This email is already a member of this organisation" }, { status: 409 });
  }

  // Reuse an existing auth account if the person already has one; otherwise create it.
  let userId = await findAuthUserByEmail(service, email);
  let tempPassword: string | null = null;

  if (!userId) {
    tempPassword = generateTempPassword();
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true, // no email service wired — admin shares creds directly
      user_metadata: { full_name: fullName, must_change_password: true },
    });
    if (createErr || !created?.user) {
      return NextResponse.json(
        { error: `Could not create account: ${createErr?.message ?? "unknown error"}` },
        { status: 500 }
      );
    }
    userId = created.user.id;
  }

  // Upsert the membership as ACTIVE and linked to the auth user. Reuses a revoked
  // row if one exists (UNIQUE(org_id, invited_email)).
  const memberFields = {
    org_id: orgId,
    user_id: userId,
    invited_email: email,
    role,
    page_access,
    status: "active" as const,
    invited_by: user.id,
  };
  const memberCols = "id, org_id, invited_email, user_id, role, page_access, status, created_at";

  const { data: member, error } = existing
    ? await service.from("org_members").update(memberFields).eq("id", existing.id).select(memberCols).single()
    : await service.from("org_members").insert(memberFields).select(memberCols).single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    {
      ...member,
      full_name: fullName,
      created: tempPassword !== null,
      credentials: tempPassword ? { email, password: tempPassword } : null,
    },
    { status: 201 }
  );
}
