export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsClient, type ConnectorToggle } from "./settings-client";

export default async function SettingsPage() {
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId) redirect("/auth/login");
  if (!org) redirect("/onboarding");
  // Settings is owner/admin only (org-level configuration).
  if (!canManageTeam) redirect("/dashboard/profile");

  // Connectors for this org, for the per-connector P&L-treatment toggles. No
  // secrets needed here — only id/name/type/status + the two include flags.
  const supabase = await createClient();
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, name, type, status, include_income, include_expense")
    .eq("org_id", org.id)
    .not("type", "in", '("google_drive","onedrive")')
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-4 max-w-[900px]">
      <PageHeader title="Settings" subtitle="Organisation settings & API access" />
      <SettingsClient connectors={(connectors ?? []) as ConnectorToggle[]} />
    </div>
  );
}
