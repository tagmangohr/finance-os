import * as React from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { TopBar } from "@/components/dashboard/top-bar";
import { MobileSidebarWrapper } from "@/components/dashboard/mobile-sidebar-wrapper";

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

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <SidebarNav org={org} userEmail={user.email ?? ""} />
      </div>

      {/* Mobile sidebar */}
      <MobileSidebarWrapper org={org} userEmail={user.email ?? ""} />

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar orgId={org.id} orgName={org.name} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
