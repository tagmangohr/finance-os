export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActiveOrg } from "@/lib/org/active-org";
import { PageHeader } from "@/components/dashboard/page-header";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId) redirect("/auth/login");
  if (!org) redirect("/onboarding");
  // Settings is owner/admin only (org-level configuration).
  if (!canManageTeam) redirect("/dashboard/profile");

  return (
    <div className="space-y-4 max-w-[900px]">
      <PageHeader title="Settings" subtitle="Organisation settings & API access" />
      <SettingsClient />
    </div>
  );
}
