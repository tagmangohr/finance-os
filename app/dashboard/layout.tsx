import * as React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { calculateRevenue } from "@/lib/intelligence/revenue";
import { calculateRunway } from "@/lib/intelligence/runway";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { TopBar } from "@/components/dashboard/top-bar";
import { MobileSidebarWrapper } from "@/components/dashboard/mobile-sidebar-wrapper";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { Ticker } from "@/components/dashboard/ticker";
import { CoPilot } from "@/components/dashboard/co-pilot";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("owner_id", user.id)
    .single();

  if (!org) redirect("/onboarding");

  // All layout queries run in parallel — connectors, entities, and live
  // intelligence metrics are fetched simultaneously to minimise page load time.
  const [connectorsResult, entitiesResult, revenueMetrics, runwayMetrics] =
    await Promise.all([
      supabase
        .from("connectors")
        .select("id, status, last_synced_at")
        .eq("org_id", org.id),
      supabase
        .from("entities")
        .select("outstanding_amount")
        .eq("org_id", org.id),
      // Computed live — no snapshot dependency
      calculateRevenue(org.id, supabase),
      calculateRunway(org.id, supabase),
    ]);

  const connectors     = connectorsResult.data;
  const connectorCount = connectors?.length ?? 0;
  const liveCount      = connectors?.filter((c) => c.status === "active").length ?? 0;
  const lastSyncedAt   = connectors
    ?.map((c) => c.last_synced_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const totalOutstanding =
    entitiesResult.data?.reduce((s, e) => s + (e.outstanding_amount ?? 0), 0) ?? 0;

  return (
    <div className="flex h-screen bg-background overflow-hidden relative z-[1]">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <SidebarNav
          org={org}
          userEmail={user.email ?? ""}
          connectorCount={connectorCount}
          liveCount={liveCount}
          lastSyncedAt={lastSyncedAt}
        />
      </div>

      {/* Mobile sidebar */}
      <MobileSidebarWrapper org={org} userEmail={user.email ?? ""} />

      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar orgId={org.id} orgName={org.name} />
        <Ticker
          cash={runwayMetrics.cash_balance}
          mrr={revenueMetrics.mrr}
          burnRate={runwayMetrics.burn_rate}
          runwayDays={runwayMetrics.runway_days}
          totalOutstanding={totalOutstanding}
        />
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 bg-background">
          <AutoRefresh />
          {children}
        </main>
      </div>

      {/* AI Co-pilot rail */}
      <div className="hidden lg:flex flex-shrink-0">
        <CoPilot orgId={org.id} />
      </div>
    </div>
  );
}
