export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { getSubscriptionsOverview } from "@/lib/subscriptions/reports";
import { SubscriptionsClient } from "./subscriptions-client";

/**
 * Subscriptions dashboard — cross-gateway recurring revenue.
 * Admin/finance-gated server-side: the subscription tables are service-role-only and
 * carry customer PII, so only owners/admins (pageAccess === null) may view. Restricted
 * members are redirected (and the tab is hidden for them by DashboardTabs filtering).
 */
export default async function SubscriptionsPage() {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) redirect("/auth/login");
  if (pageAccess !== null) redirect("/dashboard"); // owners/admins only

  const data = await getSubscriptionsOverview(org.id);
  return <SubscriptionsClient data={data} />;
}
