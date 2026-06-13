import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { UsersClient } from "./users-client";
import type { OrgMember } from "./users-client";

export const metadata = { title: "Team — Finance OS" };

export default async function UsersPage() {
  // Team management applies to the ACTIVE org. Only its owner/admin may manage it.
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId) redirect("/auth/login");
  if (!org) redirect("/onboarding");
  if (!canManageTeam) redirect("/dashboard");

  const serviceClient = await createServiceClient();
  const { data: members } = await serviceClient
    .from("org_members")
    .select("id, invited_email, user_id, role, page_access, status, created_at")
    .eq("org_id", org.id)
    .neq("status", "revoked")
    .order("created_at", { ascending: true });

  // Enrich with display names
  const enriched: OrgMember[] = await Promise.all(
    (members ?? []).map(async (m) => {
      if (!m.user_id) return { ...m, full_name: null } as OrgMember;
      const { data: authUser } = await serviceClient.auth.admin.getUserById(m.user_id);
      return {
        ...m,
        full_name: (authUser?.user?.user_metadata?.full_name as string | undefined) ?? null,
      } as OrgMember;
    })
  );

  return (
    <div className="max-w-2xl space-y-5">
      <UsersClient initialMembers={enriched} />
    </div>
  );
}
