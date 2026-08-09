import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Server-side page-access enforcement.
 *
 * `getActiveOrg().pageAccess` is `null` for owners/admins (all pages) or a
 * string[] of allowed page slugs for restricted members (managers/viewers).
 *
 * Every dashboard page is now its OWN route (Revenue, Cash Flow, Collections,
 * and Intelligence used to be tabs on /dashboard — they are standalone routes
 * now). So the model is a straight 1:1 map from access slug → route: a member
 * may open a route iff its slug is in their page_access. This removes the old
 * "analytics tabs live on /dashboard" special-casing that let some grants slip
 * through ungated and could bounce a restricted member in a redirect loop.
 */

// Single source of truth: access slug → the route that renders it. Bank and
// Subscriptions are intentionally absent — they are owner/admin-only PII pages
// (their page components redirect any restricted member) and are never grantable.
export const SLUG_ROUTES: Record<string, string> = {
  dashboard:    "/dashboard",
  revenue:      "/dashboard/revenue",
  cashflow:     "/dashboard/cashflow",
  collections:  "/dashboard/collections",
  intelligence: "/dashboard/intelligence",
  connectors:   "/dashboard/connectors",
  data:         "/dashboard/data",
};

// Preference order for where to send a restricted member who lands on a page
// they can't see. Profile is the ultimate fallback: it has no access slug, so
// it is ALWAYS reachable — a member with an empty/mismatched grant set lands
// there instead of bouncing forever.
const FALLBACK_ORDER = ["dashboard", "data", "revenue", "cashflow", "collections", "intelligence", "connectors"];
const SAFE_FALLBACK  = "/dashboard/profile";

function firstAllowedRoute(pageAccess: string[]): string {
  for (const slug of FALLBACK_ORDER) {
    if (pageAccess.includes(slug)) return SLUG_ROUTES[slug];
  }
  return SAFE_FALLBACK; // no grants line up with a real page → Profile (always allowed)
}

/** Every grantable route slug. */
export type GatedRoute = keyof typeof SLUG_ROUTES;

/**
 * Server-component guard. Call at the top of a gated page's server component.
 * Owners/admins pass through; a restricted member who lacks the slug is
 * redirected to their first allowed page. The redirect target is always a page
 * they can see (or Profile), so this can never loop.
 */
export async function requireRouteAccess(route: GatedRoute): Promise<void> {
  const { pageAccess } = await getActiveOrg();
  if (pageAccess === null) return;            // owner/admin → all pages
  if (pageAccess.includes(route)) return;     // slug granted → allowed
  redirect(firstAllowedRoute(pageAccess));
}

/**
 * API guard: whether the current user may access a given page slug *for a
 * specific org*. APIs take an explicit org_id (which may differ from the active
 * org), so we check that org's membership directly rather than the active org.
 * Owners and admins of the org get all pages.
 */
export async function hasPageAccessForOrg(orgId: string, slug: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const service = await createServiceClient();
  const { data: org } = await service
    .from("organizations")
    .select("owner_id")
    .eq("id", orgId)
    .maybeSingle();
  if (org?.owner_id === user.id) return true;

  const { data: member } = await service
    .from("org_members")
    .select("role, page_access")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!member) return false;
  if (member.role === "admin") return true;
  return Array.isArray(member.page_access) && member.page_access.includes(slug);
}

/**
 * Payments access for the current user in a given org, including the search-only
 * flag. Returns { allowed, searchOnly }. Owners/admins always get full access.
 * Used by the Payments APIs to enforce search-only server-side (a search-only
 * member gets NO rows unless they pass a search term — never bypassable).
 */
export async function getPaymentsAccessForOrg(
  orgId: string
): Promise<{ allowed: boolean; searchOnly: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { allowed: false, searchOnly: false };

  const service = await createServiceClient();
  const { data: org } = await service
    .from("organizations")
    .select("owner_id")
    .eq("id", orgId)
    .maybeSingle();
  if (org?.owner_id === user.id) return { allowed: true, searchOnly: false };

  const { data: member } = await service
    .from("org_members")
    .select("role, page_access, payments_search_only")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (!member) return { allowed: false, searchOnly: false };
  if (member.role === "admin") return { allowed: true, searchOnly: false };

  const allowed = Array.isArray(member.page_access) && member.page_access.includes("data");
  // Search-only only applies to restricted members (managers/viewers).
  return { allowed, searchOnly: allowed && member.payments_search_only === true };
}
