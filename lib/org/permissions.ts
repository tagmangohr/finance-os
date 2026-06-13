import type { createServiceClient } from "@/lib/supabase/server";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * True when `userId` may manage `orgId`'s team & settings — i.e. they own it OR
 * they are an active ADMIN member. Managers/viewers cannot manage the team.
 * Service client so it isn't blocked by RLS while resolving access.
 */
export async function canManageOrg(
  service: ServiceClient,
  userId: string,
  orgId: string
): Promise<boolean> {
  const { data: org } = await service
    .from("organizations")
    .select("owner_id")
    .eq("id", orgId)
    .maybeSingle();

  if (!org) return false;
  if (org.owner_id === userId) return true;

  const { data: member } = await service
    .from("org_members")
    .select("id")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("role", "admin")
    .maybeSingle();

  return !!member;
}
