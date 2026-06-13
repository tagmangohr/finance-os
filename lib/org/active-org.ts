import { cache } from "react";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Cookie holding the org the user is currently viewing. */
export const ACTIVE_ORG_COOKIE = "active_org_id";

// owner/admin: full access. manager: read + write on allowed pages, but cannot
// manage the team or create orgs. viewer: read-only on allowed pages.
export type OrgRole = "owner" | "admin" | "manager" | "viewer";

export type AccessibleOrg = {
  id: string;
  name: string;
  role: OrgRole;
  /** null = all pages (owner/admin); string[] = allowed page slugs (viewer). */
  pageAccess: string[] | null;
};

export type ActiveOrgContext = {
  /** null when there is no authenticated user. */
  userId: string | null;
  /** The currently-selected org, or null when the user has no accessible orgs. */
  org: AccessibleOrg | null;
  /** Owned orgs first (oldest-first), then member orgs (oldest-first). */
  accessibleOrgs: AccessibleOrg[];
  /** Page access for the ACTIVE org (null = all pages). */
  pageAccess: string[] | null;
  /** True when the user is owner/admin of the active org (manage team + settings). */
  canManageTeam: boolean;
  /** True when the user may WRITE in the active org (owner/admin/manager). */
  canWrite: boolean;
  /** True when the user may create new orgs (owner/admin of ≥1 org). */
  canCreateOrg: boolean;
};

/**
 * Every org a user can access: orgs they own + orgs where they're an ACTIVE
 * member. Uses the service client so RLS recursion / missing-table edge cases
 * can never make a page silently lose access. Owned orgs are listed first.
 */
export async function listAccessibleOrgs(
  userId: string,
  userEmail: string
): Promise<AccessibleOrg[]> {
  const service = await createServiceClient();

  // ── Owned orgs (oldest first) ──────────────────────────────────────────────
  const { data: owned } = await service
    .from("organizations")
    .select("id, name, created_at")
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });

  const seen = new Set<string>();
  const result: AccessibleOrg[] = [];

  for (const o of owned ?? []) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    result.push({ id: o.id, name: o.name, role: "owner", pageAccess: null });
  }

  // ── Active member orgs (skip ones already owned) ─────────────────────────────
  try {
    const orFilter = userEmail
      ? `user_id.eq.${userId},invited_email.eq.${userEmail}`
      : `user_id.eq.${userId}`;

    const { data: members } = await service
      .from("org_members")
      .select("role, page_access, created_at, organizations(id, name)")
      .or(orFilter)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    for (const m of members ?? []) {
      const org = m.organizations as unknown as { id: string; name: string } | null;
      if (!org || seen.has(org.id)) continue;
      seen.add(org.id);
      const role = (m.role as OrgRole) ?? "viewer";
      result.push({
        id: org.id,
        name: org.name,
        role,
        pageAccess: role === "admin" ? null : ((m.page_access as string[]) ?? []),
      });
    }
  } catch {
    // org_members table not present (migration not applied) — owned orgs only.
  }

  return result;
}

/**
 * Resolve the user's CURRENT org from the active-org cookie, falling back to the
 * first accessible org when the cookie is missing or points to an org the user
 * can no longer access. Memoised per request so the layout + every page share
 * one resolution pass.
 *
 * Note: this never WRITES the cookie (server components can't). A stale cookie
 * is simply ignored; the cookie is (re)written only by setActiveOrgAction /
 * org creation, which run as server actions.
 */
export const getActiveOrg = cache(async (): Promise<ActiveOrgContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      userId: null,
      org: null,
      accessibleOrgs: [],
      pageAccess: null,
      canManageTeam: false,
      canWrite: false,
      canCreateOrg: false,
    };
  }

  const accessibleOrgs = await listAccessibleOrgs(user.id, user.email ?? "");

  const cookieStore = await cookies();
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;

  const org =
    accessibleOrgs.find((o) => o.id === cookieOrgId) ?? accessibleOrgs[0] ?? null;

  const role = org?.role;
  return {
    userId: user.id,
    org,
    accessibleOrgs,
    pageAccess: org?.pageAccess ?? null,
    canManageTeam: role === "owner" || role === "admin",
    canWrite: role === "owner" || role === "admin" || role === "manager",
    canCreateOrg: accessibleOrgs.some((o) => o.role === "owner" || o.role === "admin"),
  };
});
