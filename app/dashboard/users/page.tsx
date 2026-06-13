import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { UsersClient } from "./users-client";
import type { OrgGroup, OrgMember } from "./users-client";

export const metadata = { title: "Team — Finance OS" };

export default async function UsersPage() {
  // Central team management: show every org the user can manage (owner/admin).
  const { userId, accessibleOrgs } = await getActiveOrg();
  if (!userId) redirect("/auth/login");

  const manageable = accessibleOrgs.filter((o) => o.role === "owner" || o.role === "admin");
  if (manageable.length === 0) redirect("/dashboard");

  const service = await createServiceClient();

  const groups: OrgGroup[] = await Promise.all(
    manageable.map(async (org) => {
      const { data: members } = await service
        .from("org_members")
        .select("id, org_id, invited_email, user_id, role, page_access, status, created_at")
        .eq("org_id", org.id)
        .neq("status", "revoked")
        .order("created_at", { ascending: true });

      const enriched: OrgMember[] = await Promise.all((members ?? []).map(async (m) => {
        if (!m.user_id) return { ...m, full_name: null } as OrgMember;
        const { data: authUser } = await service.auth.admin.getUserById(m.user_id);
        return {
          ...m,
          full_name: (authUser?.user?.user_metadata?.full_name as string | undefined) ?? null,
        } as OrgMember;
      }));

      return { org: { id: org.id, name: org.name }, members: enriched };
    })
  );

  return (
    <div className="max-w-2xl space-y-5">
      <UsersClient groups={groups} />
    </div>
  );
}
