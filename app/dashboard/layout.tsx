import * as React from "react";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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

  // ── Resolve org and access rights ─────────────────────────────────────────
  // Priority: owner → active member → pending invite (auto-activate) → onboarding
  type OrgRow = { id: string; name: string };
  let org:          OrgRow | null = null;
  let pageAccess:   string[] | null = null;   // null = all pages
  let canManageTeam = false;

  // 1. Check if this user owns an org (most common path)
  const { data: ownedOrg } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("owner_id", user.id)
    .single();

  if (ownedOrg) {
    org           = ownedOrg;
    pageAccess    = null;      // owner sees everything
    canManageTeam = true;
  } else {
    // 2. Check org_members — use service client so we can also detect pending invites
    const serviceClient = await createServiceClient();

    const { data: memberRow } = await serviceClient
      .from("org_members")
      .select("id, org_id, role, page_access, status, organizations(id, name)")
      .or(`user_id.eq.${user.id},invited_email.eq.${user.email ?? ""}`)
      .not("status", "eq", "revoked")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (memberRow) {
      // Auto-activate a pending invite
      if (memberRow.status === "pending") {
        await serviceClient
          .from("org_members")
          .update({ user_id: user.id, status: "active" })
          .eq("id", memberRow.id);
      }

      const memberOrgData = memberRow.organizations as unknown as OrgRow | null;
      if (memberOrgData) {
        org           = memberOrgData;
        pageAccess    = memberRow.role === "admin" ? null : (memberRow.page_access as string[]);
        canManageTeam = memberRow.role === "admin";
      }
    }
  }

  if (!org) redirect("/onboarding");

  // ── Parallel data fetching ─────────────────────────────────────────────────
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

  const userName = (user.user_metadata?.full_name as string | undefined) ?? "";

  return (
    <div className="flex h-screen bg-background overflow-hidden relative z-[1]">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <SidebarNav
          org={org}
          userEmail={user.email ?? ""}
          userName={userName}
          pageAccess={pageAccess}
          canManageTeam={canManageTeam}
          connectorCount={connectorCount}
          liveCount={liveCount}
          lastSyncedAt={lastSyncedAt}
        />
      </div>

      {/* Mobile sidebar */}
      <MobileSidebarWrapper
        org={org}
        userEmail={user.email ?? ""}
        userName={userName}
        pageAccess={pageAccess}
        canManageTeam={canManageTeam}
      />

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
