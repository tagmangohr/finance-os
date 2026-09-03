import type { createServiceClient } from "@/lib/supabase/server";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

// ~100 years — GoTrue treats a long ban_duration as "account disabled": the user
// cannot sign in and all their sessions are invalidated. Reversible via enableLogin.
const BAN_FOREVER = "876000h";

/**
 * Does this user still have access ANYWHERE — an active membership in some org, or
 * ownership of one? Used to decide whether removing them from one org should also
 * disable their login (only if they're now orphaned with no access at all).
 */
async function hasAccessSomewhere(service: ServiceClient, userId: string): Promise<boolean> {
  const [mem, owned] = await Promise.all([
    service.from("org_members").select("id").eq("user_id", userId).eq("status", "active").limit(1),
    service.from("organizations").select("id").eq("owner_id", userId).limit(1),
  ]);
  return (mem.data?.length ?? 0) > 0 || (owned.data?.length ?? 0) > 0;
}

/**
 * After a member is removed, block their LOGIN entirely — but ONLY when they have no
 * access left in any org (otherwise they still need to sign in for those). This is
 * what enforces "once removed, they can't log in at all". MUST be called AFTER the
 * membership row is already set to 'revoked', so the access check sees the new state.
 * Best-effort: a failure here never blocks the removal itself.
 */
export async function disableLoginIfOrphaned(service: ServiceClient, userId: string | null): Promise<void> {
  if (!userId) return; // pending invite never accepted → no auth account yet
  try {
    if (await hasAccessSomewhere(service, userId)) return; // still a member elsewhere → keep login
    await service.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER });
  } catch (e) {
    console.error("[account-access] disable login failed (non-fatal):", e);
  }
}

/**
 * Lift any login ban — called when (re)adding a member so a previously-removed,
 * disabled person can accept the new invite and sign in again. Idempotent
 * (unbanning a non-banned user is a no-op). Best-effort.
 */
export async function enableLogin(service: ServiceClient, userId: string | null): Promise<void> {
  if (!userId) return;
  try {
    await service.auth.admin.updateUserById(userId, { ban_duration: "none" });
  } catch (e) {
    console.error("[account-access] enable login failed (non-fatal):", e);
  }
}
