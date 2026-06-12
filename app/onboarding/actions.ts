"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  // Random 6-char suffix — collision-proof across retries and other users
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function createOrgAction(formData: {
  name: string;
  currency: string;
  timezone: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // If the user already has an org (e.g. double-submit or stale page),
  // just send them to the dashboard — don't error.
  const { data: existing } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    redirect("/dashboard");
  }

  // Try twice with different random slugs — astronomically unlikely to collide twice
  for (let i = 0; i < 2; i++) {
    const { error } = await supabase.from("organizations").insert({
      name:     formData.name.trim(),
      slug:     generateSlug(formData.name),
      currency: formData.currency,
      timezone: formData.timezone,
      owner_id: user.id,
    });
    if (!error) {
      // Org created — redirect server-side so the dashboard gets fresh cookies
      redirect("/dashboard");
    }
    // Anything other than a unique-violation is a real error — surface it.
    if ((error as { code?: string }).code !== "23505") {
      return { error: error.message };
    }
    // A 23505 here is now ambiguous: it could be the slug (retry with a new one)
    // OR the owner_id UNIQUE constraint (migration 016) firing because this
    // owner already has an org — e.g. a double-submit. If an org already
    // exists for this user, treat it as success and go to the dashboard.
    const { data: now } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (now) {
      redirect("/dashboard");
    }
    // Otherwise it was a slug collision — loop retries with a fresh random slug.
  }

  return { error: "Could not generate a unique slug. Please try again." };
}
