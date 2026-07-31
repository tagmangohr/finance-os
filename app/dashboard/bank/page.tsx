export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getBankOverview } from "@/lib/expenses/reports";
import { BankClient } from "./bank-client";

/**
 * Bank ledger + expense categorization.
 * Admin/finance-gated server-side (same posture as Subscriptions): bank rows are
 * not client-readable, carry vendor/payroll detail, and the taxonomy tables are
 * service-role only — so only owners/admins (pageAccess === null) may view. The
 * "Bank" sidebar item is likewise hidden for restricted members.
 */
export default async function BankPage() {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) redirect("/auth/login");
  if (pageAccess !== null) redirect("/dashboard"); // owners/admins only

  const sb = await createServiceClient();
  const [data, connectorCount] = await Promise.all([
    getBankOverview(org.id, sb),
    sb.from("connectors").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("type", "mercury"),
  ]);

  return <BankClient data={data} hasBankConnector={(connectorCount.count ?? 0) > 0} />;
}
