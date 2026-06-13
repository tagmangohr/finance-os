import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Build a globally-unique slug from a name. Slugs are UNIQUE across all orgs
 * (organizations_slug_key), so we append a short random suffix to avoid
 * collisions with other orgs/users — and retry on the off chance of a clash.
 */
export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "org";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/**
 * Insert a new organisation owned by `userId`. Shared by the onboarding flow
 * (first org) and the in-dashboard "Create organisation" flow (Nth org) so the
 * creation rules stay in one place.
 *
 * Multiple orgs per owner are intentional (verticals), so the ONLY unique
 * constraint we can hit is the slug — a 23505 means a slug clash, which we
 * retry with a fresh random suffix.
 */
export async function insertOrg(
  supabase: ServerClient,
  userId: string,
  input: { name: string; currency: string; timezone: string }
): Promise<{ orgId?: string; error?: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Organisation name is required." };

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from("organizations")
      .insert({
        name,
        slug: generateSlug(name),
        currency: input.currency,
        timezone: input.timezone,
        owner_id: userId,
      })
      .select("id")
      .single();

    if (!error && data) return { orgId: data.id };

    const code = (error as { code?: string } | null)?.code;
    const message = (error as { message?: string } | null)?.message ?? "";

    // Retry ONLY on a genuine SLUG collision (random suffix → astronomically
    // rare). Any other unique violation (e.g. a stray UNIQUE(owner_id) left over
    // from the abandoned one-org-per-owner migration) is NOT a slug problem —
    // looping just hides it behind a misleading message, so surface it instead.
    if (code === "23505" && message.toLowerCase().includes("slug")) {
      continue;
    }
    return { error: message || "Failed to create organisation." };
  }

  return { error: "Could not generate a unique slug. Please try again." };
}
