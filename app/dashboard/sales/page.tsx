export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { requireRouteAccess } from "@/lib/org/page-access";
import { createServiceClient } from "@/lib/supabase/server";
import { getSalesOverviewCached, hasSalesRows, getSalesSources } from "@/lib/sales/reports";
import { SalesClient } from "./sales-client";

/**
 * Sales tab — a flexible, sheet/CSV-fed revenue ledger (ledger='sales'). Sales
 * counts as revenue in the P&L/Dashboard (additive to PG, single-source rule), and
 * every source column is preserved so it can be broken down by any dimension.
 *
 * PII-gated server-side (same posture as Bank/Subscriptions): sales rows carry
 * customer/product detail and aren't client-readable — owners/admins, or members
 * granted the "sales" page, may view.
 */
export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { org } = await getActiveOrg();
  if (!org) redirect("/auth/login");
  await requireRouteAccess("sales");

  const sp = await searchParams;
  const isDate = (v?: string): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const range = {
    from: isDate(sp.from) ? sp.from : undefined,
    to: isDate(sp.to) ? sp.to : undefined,
    dimension: sp.dimension || undefined,
  };
  const sb = await createServiceClient();

  const [data, hasSales, sources] = await Promise.all([
    getSalesOverviewCached(org.id, range),
    hasSalesRows(org.id, sb),
    getSalesSources(org.id, sb),
  ]);

  return <SalesClient data={data} hasSales={hasSales} sources={sources} />;
}
