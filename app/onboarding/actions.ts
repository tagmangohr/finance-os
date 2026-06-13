"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { insertOrg } from "@/lib/org/create-org";
import { ACTIVE_ORG_COOKIE } from "@/lib/org/active-org";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // 1 year
};

/**
 * Create the user's first organisation (onboarding) and make it active.
 * Returns {} on success — the form then does a full reload into /dashboard so
 * the new session cookie + active-org cookie are both in play on the next
 * server render (the auth-context lesson: never client-nav after a cookie change).
 */
export async function createOrgAction(formData: {
  name: string;
  currency: string;
  timezone: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Already has an org? Just activate the first one and move on — no duplicate.
  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const cookieStore = await cookies();

  if (existing) {
    cookieStore.set(ACTIVE_ORG_COOKIE, existing.id, COOKIE_OPTIONS);
    return {};
  }

  const { orgId, error } = await insertOrg(supabase, user.id, formData);
  if (error || !orgId) return { error: error ?? "Failed to create organisation." };

  cookieStore.set(ACTIVE_ORG_COOKIE, orgId, COOKIE_OPTIONS);
  return {};
}
