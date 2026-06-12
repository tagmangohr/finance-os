import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { UsersClient } from "./users-client";
import type { OrgMember } from "./users-client";

export const metadata = { title: "Team — Finance OS" };

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  // Only org owners (and admins — checked below) can manage the team
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Also allow org admins
  let isAdmin = !!org;
  if (!org) {
    const { data: member } = await supabase
      .from("org_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .eq("status", "active")
      .single();
    isAdmin = !!member;
  }

  if (!isAdmin) redirect("/dashboard");

  // Fetch all members via service client (owner's org)
  const serviceClient = await createServiceClient();
  const orgId = org?.id ?? (() => {
    // Shouldn't reach here but handle gracefully
    return null;
  })();

  if (!orgId) redirect("/dashboard");

  const { data: members } = await serviceClient
    .from("org_members")
    .select("id, invited_email, user_id, role, page_access, status, created_at")
    .eq("org_id", orgId)
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
