export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { createClient } from "@/lib/supabase/server";
import { getSubscriptionsOverview } from "@/lib/subscriptions/reports";
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
  const { org, pageAccess } = await getActiveOrg();
  if (!org) redirect("/auth/login");
  if (pageAccess !== null) redirect("/dashboard"); // owners/admins only

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [data, prefs] = await Promise.all([
    getSubscriptionsOverview(org.id, GRACE_MONTHS),
    user ? getSubMetricPrefs(user.id, org.id, supabase) : Promise.resolve(subDefaultPrefs()),
  ]);
  return <SubscriptionsClient data={data} prefs={prefs} orgId={org.id} />;
}
