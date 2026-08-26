export const dynamic = "force-dynamic";
// Headroom for a cold cache-miss compute (8 analytical queries incl. the monthly-
// metrics cross-join) so it completes instead of 504-ing at the default limit — the
// missing maxDuration was blanking this page. Warm loads are served from the org
// cache in ms. (Same posture as the Bank page.)
export const maxDuration = 60;

import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { requireRouteAccess } from "@/lib/org/page-access";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionsOverviewCached } from "@/lib/subscriptions/reports";
import { getSubMetricPrefs, subDefaultPrefs } from "@/lib/subscriptions/metric-prefs";
import { SubscriptionsClient } from "./subscriptions-client";

/**
 * Subscriptions dashboard — cross-gateway recurring revenue.
 * Admin/finance-gated server-side: the subscription tables are service-role-only and
 * carry customer PII, so only owners/admins (pageAccess === null) may view. Restricted
 * members are redirected (and the tab is hidden for them by DashboardTabs filtering).
 *
 * Churn cutoff is fixed at 1 month: once a subscription is >1 month past its due date
 * (and not cancelled) it's churned; within that month it's "past-due (revivable)".
 */
const GRACE_MONTHS = 1;

export default async function SubscriptionsPage() {
  const { org } = await getActiveOrg();
  if (!org) redirect("/auth/login");
  await requireRouteAccess("subscriptions"); // owners/admins, or members granted the page

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [data, prefs] = await Promise.all([
    getSubscriptionsOverviewCached(org.id, GRACE_MONTHS),
    user ? getSubMetricPrefs(user.id, org.id, supabase) : Promise.resolve(subDefaultPrefs()),
  ]);
  return <SubscriptionsClient data={data} prefs={prefs} orgId={org.id} />;
}
