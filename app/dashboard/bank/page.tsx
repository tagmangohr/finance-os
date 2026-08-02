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
export default async function BankPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) redirect("/auth/login");
  if (pageAccess !== null) redirect("/dashboard"); // owners/admins only

  // Date-range from the URL (?from=YYYY-MM-DD&to=YYYY-MM-DD); default = current FY.
  const sp = await searchParams;
  const isDate = (v?: string): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const range = { from: isDate(sp.from) ? sp.from : undefined, to: isDate(sp.to) ? sp.to : undefined };

  const sb = await createServiceClient();
  const [data, connectorCount] = await Promise.all([
    getBankOverview(org.id, sb, range),
    sb.from("connectors").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("type", "mercury"),
  ]);

  return <BankClient data={data} hasBankConnector={(connectorCount.count ?? 0) > 0} />;
}
