import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { PageHeader } from "@/components/dashboard/page-header";
import { ProfileClient } from "./profile-client";

export const metadata = { title: "Profile — Finance OS" };

export default async function ProfilePage() {
  const supabase = await createClient();

  // Show details for the ACTIVE org (owned or member).
  const { userId, org: active, canManageTeam, accessibleOrgs } = await getActiveOrg();
  if (!userId) redirect("/auth/login");
  if (!active) redirect("/onboarding");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Active org's settings via the RLS user client — access is already proven by
  // getActiveOrg returning it in the accessible set.
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, currency, timezone")
    .eq("id", active.id)
    .maybeSingle();

  return (
    <div className="space-y-5">
      <PageHeader title="Profile" subtitle="Manage your account and company settings" />
      <ProfileClient
        initial={{
          user: {
            id: user.id,
            email: user.email ?? "",
            full_name: (user.user_metadata?.full_name as string | undefined) ?? "",
            avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
            member_since: user.created_at ?? null,
          },
          org,
          is_owner: active.role === "owner",
          can_manage: canManageTeam, // owner OR admin → may edit org details
          active_org_id: active.id,
          // Every org the user belongs to, with their role — powers the "at a glance" rail.
          orgs: accessibleOrgs.map((o) => ({ id: o.id, name: o.name, role: o.role })),
        }}
      />
    </div>
  );
}
