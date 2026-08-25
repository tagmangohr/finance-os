export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { requireRouteAccess } from "@/lib/org/page-access";
import { createServiceClient } from "@/lib/supabase/server";
import { getBankOverviewCached } from "@/lib/expenses/reports";
import { BankClient } from "./bank-client";

/**
 * Bank ledger + expense categorization.
 * Admin/finance-gated server-side (same posture as Subscriptions): bank rows are
 * not client-readable, carry vendor/payroll detail, and the taxonomy tables are
 * service-role only — so only owners/admins (pageAccess === null) may view. The
 * "Bank" sidebar item is likewise hidden for restricted members.
 */
export default async function BankPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { org } = await getActiveOrg();
  if (!org) redirect("/auth/login");
  await requireRouteAccess("bank"); // owners/admins, or members granted the page

  const sp = await searchParams;
  const isDate = (v?: string): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const sb = await createServiceClient();

  // Default the range to cover ALL bank history (earliest bank row → today, capped
  // to 5 years) so nothing that needs review is hidden. The user can narrow with the
  // date picker for period analysis. Explicit ?from/?to always win.
  let from = isDate(sp.from) ? sp.from : undefined;
  const to = isDate(sp.to) ? sp.to : undefined;
  if (!from) {
    const floor = new Date(); floor.setFullYear(floor.getFullYear() - 5);
    const floorIso = floor.toISOString().slice(0, 10);
    const { data: earliest } = await sb
      .from("transactions")
      .select("transaction_date")
      .eq("org_id", org.id)
      .eq("ledger", "bank")
      .order("transaction_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    const e = earliest?.transaction_date as string | undefined;
    from = e ? (e < floorIso ? floorIso : e) : undefined; // undefined → getBankOverview falls back to FY start
  }
  const range = { from, to };

  const [data, connectorCount] = await Promise.all([
    getBankOverviewCached(org.id, range),
    sb.from("connectors").select("id", { count: "exact", head: true }).eq("org_id", org.id).eq("type", "mercury"),
  ]);

  return <BankClient data={data} hasBankConnector={(connectorCount.count ?? 0) > 0} />;
}
