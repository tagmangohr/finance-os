import * as React from "react";
import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { TopBar } from "@/components/dashboard/top-bar";
import { MobileSidebarWrapper } from "@/components/dashboard/mobile-sidebar-wrapper";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { CoPilot } from "@/components/dashboard/co-pilot";
import { NavProgressProvider } from "@/components/dashboard/nav-progress";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // ── Force first-login password change ──────────────────────────────────────
  // Admin-created users get a temp password + must_change_password flag. Until
  // they set their own, every dashboard route bounces to the change-password
  // screen (which lives OUTSIDE /dashboard, so this can't loop).
  if (user.user_metadata?.must_change_password === true) {
    redirect("/account/change-password");
  }

  // ── Auto-activate any pending invites for this email ───────────────────────
  // Done BEFORE resolving the active org so a freshly-accepted invite is usable
  // immediately. Service client + try/catch so a missing org_members table (or
  // service-client hiccup) never bounces the user to onboarding.
  try {
    const serviceClient = await createServiceClient();
    await serviceClient
      .from("org_members")
      .update({ user_id: user.id, status: "active" })
      .eq("invited_email", user.email ?? "")
      .eq("status", "pending");
  } catch {
    // org_members not present yet — ignore.
  }

  // ── Resolve the active org (cookie-selected, validated, oldest as fallback) ──
  const { org, accessibleOrgs, pageAccess, canManageTeam, canCreateOrg } =
    await getActiveOrg();
  if (!org) redirect("/onboarding");

  // ── Connector status for the sidebar ───────────────────────────────────────
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, status, last_synced_at")
    .eq("org_id", org.id);

  const connectorCount = connectors?.length ?? 0;
  const liveCount      = connectors?.filter((c) => c.status === "active").length ?? 0;
  const lastSyncedAt   = connectors
    ?.map((c) => c.last_synced_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  const userName = (user.user_metadata?.full_name as string | undefined) ?? "";

  return (
    <div className="flex h-screen bg-background overflow-hidden relative z-[1]">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <SidebarNav
          org={org}
          accessibleOrgs={accessibleOrgs}
          canCreateOrg={canCreateOrg}
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
        accessibleOrgs={accessibleOrgs}
        canCreateOrg={canCreateOrg}
        userEmail={user.email ?? ""}
        userName={userName}
        pageAccess={pageAccess}
        canManageTeam={canManageTeam}
      />

      {/* Main column */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar orgId={org.id} orgName={org.name} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-5 bg-background">
          <AutoRefresh />
          <NavProgressProvider>
            {children}
          </NavProgressProvider>
        </main>
      </div>

      {/* AI Co-pilot — floating button + popup (bottom-right, all screens).
          Shown to owners/admins (pageAccess === null) and members granted the
          "intelligence" capability; hidden for everyone else. */}
      {(pageAccess === null || pageAccess.includes("intelligence")) && (
        <CoPilot orgId={org.id} />
      )}
    </div>
  );
}
