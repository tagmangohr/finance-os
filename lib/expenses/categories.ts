import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerCategory, Treatment } from "./types";

/**
 * The effective category taxonomy for an org: system defaults (org_id NULL) plus
 * any org-specific categories, with the org-specific row winning on slug collision.
 * Must be called with the SERVICE client — ledger_categories is service-role only.
 */
export async function getCategories(orgId: string, supabase: SupabaseClient): Promise<LedgerCategory[]> {
  const { data } = await supabase
    .from("ledger_categories")
    .select("slug, label, treatment, flow, sort, is_system, org_id")
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .order("sort", { ascending: true });

  const bySlug = new Map<string, LedgerCategory>();
  for (const c of (data ?? []) as LedgerCategory[]) {
    const existing = bySlug.get(c.slug);
    // Prefer an org-specific row over the system default of the same slug.
    if (!existing || (c.org_id && !existing.org_id)) bySlug.set(c.slug, c);
  }
  return Array.from(bySlug.values()).sort((a, b) => a.sort - b.sort);
}

/** slug → P&L treatment. Unknown slug resolves to 'uncategorized'. */
export function treatmentMap(cats: LedgerCategory[]): Map<string, Treatment> {
  return new Map(cats.map((c) => [c.slug, c.treatment]));
}

/** slug → human label, for rendering slugs stored on transactions. */
export function labelMap(cats: LedgerCategory[]): Map<string, string> {
  return new Map(cats.map((c) => [c.slug, c.label]));
}
