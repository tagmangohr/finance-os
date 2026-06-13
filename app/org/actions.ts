"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { insertOrg } from "@/lib/org/create-org";
import { ACTIVE_ORG_COOKIE, listAccessibleOrgs } from "@/lib/org/active-org";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // 1 year
};

/**
 * Switch the active org. Validates the user actually has access to the target
 * before writing the cookie (so a tampered id can't grant access). The client
 * does a full reload afterwards so every server component re-resolves the org.
 */
export async function setActiveOrgAction(orgId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  const accessible = await listAccessibleOrgs(user.id, user.email ?? "");
  if (!accessible.some((o) => o.id === orgId)) {
    return { error: "You don't have access to that organisation." };
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, COOKIE_OPTIONS);
  return {};
}

/**
 * Create a new org and make it the active one. Used by the in-dashboard
 * "Create organisation" modal. Only owners/admins of an existing org may create
 * additional orgs; a user with no orgs at all uses the onboarding flow instead.
 */
export async function createOrgAndSwitchAction(input: {
  name: string;
  currency: string;
  timezone: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated." };

  // Permission: must be owner/admin of at least one existing org.
  const accessible = await listAccessibleOrgs(user.id, user.email ?? "");
  const canCreate = accessible.some((o) => o.role === "owner" || o.role === "admin");
  if (!canCreate) {
    return { error: "Only an owner or admin can create a new organisation." };
  }

  const { orgId, error } = await insertOrg(supabase, user.id, input);
  if (error || !orgId) return { error: error ?? "Failed to create organisation." };

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, COOKIE_OPTIONS);
  return {};
}
