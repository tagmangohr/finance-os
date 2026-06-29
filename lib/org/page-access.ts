import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Server-side page-access enforcement.
 *
 * `getActiveOrg().pageAccess` is `null` for owners/admins (all pages) or a
 * string[] of allowed page slugs for restricted members (managers/viewers).
 *
 * The analytics tabs (revenue/cashflow/collections/intelligence) all live on
 * the single `/dashboard` route and are filtered client-side, so route-level
 * enforcement gates three real routes: the dashboard (any tab slug grants it),
 * Connectors, and Raw Data.
 */

// Slugs whose page is the tabbed /dashboard route.
const DASHBOARD_TAB_SLUGS = ["dashboard", "revenue", "cashflow", "collections", "intelligence"];

// Where to send a restricted member who hits a page they can't see. Order =
// preference; tab slugs resolve to /dashboard.
const FALLBACK_ORDER: { slug: string; route: string }[] = [
  { slug: "dashboard",    route: "/dashboard" },
  { slug: "revenue",      route: "/dashboard" },
  { slug: "cashflow",     route: "/dashboard" },
  { slug: "collections",  route: "/dashboard" },
  { slug: "intelligence", route: "/dashboard" },
  { slug: "connectors",   route: "/dashboard/connectors" },
  { slug: "data",         route: "/dashboard/data" },
];

function firstAllowedRoute(pageAccess: string[]): string {
  for (const { slug, route } of FALLBACK_ORDER) {
    if (pageAccess.includes(slug)) return route;
  }
  return "/dashboard"; // safety net — should not happen for a valid member
}

export type GatedRoute = "dashboard" | "connectors" | "data";

function routeAllowed(route: GatedRoute, pageAccess: string[]): boolean {
  if (route === "dashboard") return DASHBOARD_TAB_SLUGS.some((s) => pageAccess.includes(s));
  return pageAccess.includes(route);
}

/**
 * Server-component guard. Call at the top of a gated page's server component.
 * Owners/admins pass through; a restricted member who lacks the route is
 * redirected to their first allowed page (never loops — the redirect target is
 * always a route they're allowed to see).
 */
export async function requireRouteAccess(route: GatedRoute): Promise<void> {
  const { pageAccess } = await getActiveOrg();
  if (pageAccess === null) return; // owner/admin → all pages
  if (routeAllowed(route, pageAccess)) return;
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
