import * as React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  // Connector status for sidebar STATUS section
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, status, last_synced_at")
    .eq("org_id", org.id);

  const connectorCount = connectors?.length ?? 0;
  const liveCount = connectors?.filter((c) => c.status === "active").length ?? 0;
  const lastSyncedAt = connectors
    ?.map((c) => c.last_synced_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  // Headline numbers for ticker tape
  const { data: snapshot } = await supabase
    .from("financial_snapshots")
    .select("cash_balance, mrr, burn_rate, runway_days")
    .eq("org_id", org.id)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  const { data: entities } = await supabase
    .from("entities")
    .select("outstanding_amount")
    .eq("org_id", org.id);

  const totalOutstanding = entities?.reduce((s, e) => s + (e.outstanding_amount ?? 0), 0) ?? 0;

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
          cash={snapshot?.cash_balance ?? 0}
          mrr={snapshot?.mrr ?? 0}
          burnRate={snapshot?.burn_rate ?? 0}
          runwayDays={snapshot?.runway_days ?? 0}
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
