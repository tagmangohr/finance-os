export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { requireRouteAccess } from "@/lib/org/page-access";
import { DataExplorerClient } from "./data-client";

export default async function DataPage() {
  const supabase = await createClient();

  const { userId, org, paymentsSearchOnly } = await getActiveOrg();
  if (!userId) redirect("/auth/login");
  if (!org) redirect("/onboarding");
  // Restricted members without "data" access can't reach Raw Data by URL.
  await requireRouteAccess("data");

  // Populate the source filter with only connectors that actually have
  // PAYMENTS-ledger rows — Payments shows gateway money, so bank-routed sources
  // (Mercury, a bank-tab Google Sheet) shouldn't clutter the dropdown.
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, name, type")
    .eq("org_id", org.id)
    .order("created_at", { ascending: true });

  const all = connectors ?? [];
  const svc = await createServiceClient();
  // We only need to know whether each connector has ANY payments-ledger rows — an
  // existence check (LIMIT 1), NOT a full count(exact). count(exact) over a large
  // payments table (Fiesta has ~450k rows) scans every row and blows the 8s
  // statement timeout, which was making this page fail to load.
  const counts = await Promise.all(
    all.map((c) =>
      svc
        .from("transactions")
        .select("id")
        .eq("org_id", org.id)
        .eq("connector_id", c.id)
        // Payments explorer = PG money only; exclude bank + sales ledgers.
        .eq("ledger", "payments")
        .limit(1)
    )
  );
  const paymentsConnectors = all.filter((_, i) => (counts[i].data?.length ?? 0) > 0);

  return (
    <DataExplorerClient
      orgId={org.id}
      connectors={paymentsConnectors}
      searchOnly={paymentsSearchOnly}
    />
  );
}
