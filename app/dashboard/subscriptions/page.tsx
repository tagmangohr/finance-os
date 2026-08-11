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
 *
 * `?grace=<months>` sets the revival window: a lapsed (period-end passed) subscription
 * stays "past-due (revivable)" for this many months before it's treated as churned.
 */
export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ grace?: string }>;
}) {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) redirect("/auth/login");
  if (pageAccess !== null) redirect("/dashboard"); // owners/admins only

  const { grace } = await searchParams;
  const g = Math.min(48, Math.max(1, Number(grace) || 6));
  const data = await getSubscriptionsOverview(org.id, g);
  return <SubscriptionsClient data={data} />;
}
