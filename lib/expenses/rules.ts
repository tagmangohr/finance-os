import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategoryRule } from "./types";

/** Escape SQL LIKE wildcards so an (i)like match on a literal string is exact
 *  (a counterparty like "A_B" or "50% Off Co" must not act as a wildcard). */
export function likeEscape(v: string): string {
  return v.replace(/([\\%_])/g, "\\$1");
}

/**
 * Deterministic categorization layer: counterparty/description/source → category.
 * System rules (org_id NULL, e.g. PG-settlement detection) + this org's remembered
 * rules. Must be called with the SERVICE client (category_rules is service-only).
 */
export async function getRules(orgId: string, supabase: SupabaseClient): Promise<CategoryRule[]> {
  const { data } = await supabase
    .from("category_rules")
    .select("id, org_id, match_field, match_type, match_value, match_counterparty, category_slug, priority, source")
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .order("priority", { ascending: true });
  return (data ?? []) as CategoryRule[];
}

type MatchableTxn = {
  counterparty_name: string | null;
  description: string | null;
  source: string | null;
};

/**
 * First matching rule wins. Ordered by priority asc, then org-specific before
 * system at equal priority (a company's own rule overrides a generic seed).
 */
export function matchRule(txn: MatchableTxn, rules: CategoryRule[]): string | null {
  const sorted = [...rules].sort(
    (a, b) => a.priority - b.priority || (b.org_id ? 1 : 0) - (a.org_id ? 1 : 0)
  );
  for (const r of sorted) {
    const field =
      r.match_field === "counterparty" ? txn.counterparty_name
      : r.match_field === "description" ? txn.description
      : txn.source;
    if (!field) continue;
    const hay = field.toLowerCase();
    const needle = r.match_value.toLowerCase();
    const hit = r.match_type === "exact" ? hay === needle : hay.includes(needle);
    if (!hit) continue;
    // Composite COUNTERPARTY scope. A rule remembered for one merchant only
    // applies to rows with that same counterparty. This is what stops a generic
    // shared description (e.g. Mercury's "Send Money transaction initiated on
    // Mercury", identical across 35 different payees) from dragging one merchant's
    // category onto all the others. Unscoped rules (match_counterparty NULL) keep
    // their original behaviour. A scope mismatch falls through to lower-priority
    // rules rather than returning — a broader counterparty rule may still apply.
    if (r.match_counterparty) {
      if ((txn.counterparty_name ?? "").toLowerCase() !== r.match_counterparty.toLowerCase()) continue;
    }
    return r.category_slug;
  }
  return null;
}

/**
 * Persist a manual categorization as a durable EXACT-DESCRIPTION rule so only rows
 * with the IDENTICAL description auto-apply next time. This is the precise "memory":
 * two descriptions under the same merchant (e.g. "ANTHROPIC* CLAUDE TEAM" vs
 * "ANTHROPIC* CLAUDE SUB") stay independently categorizable — a counterparty-level
 * rule would wrongly collapse them. Priority 40 (above counterparty's 50), so an
 * explicit per-description decision overrides any broader counterparty rule.
 * Upsert-by-hand (the uniqueness guard is an expression index PostgREST can't target).
 */
export async function rememberDescriptionRule(
  orgId: string,
  description: string,
  counterparty: string | null,
  slug: string,
  supabase: SupabaseClient
): Promise<void> {
  const value = description.trim();
  if (!value) return;
  // Scope the rule to the counterparty so it can never leak onto a different
  // merchant that shares this description. A missing counterparty stays unscoped
  // (NULL) — the caller only reaches here for rows that HAVE a counterparty.
  const cp = (counterparty ?? "").trim() || null;

  let lookup = supabase
    .from("category_rules")
    .select("id")
    .eq("org_id", orgId)
    .eq("match_field", "description")
    .eq("match_type", "exact")
    .ilike("match_value", likeEscape(value)); // exact, case-insensitive (wildcards escaped)
  lookup = cp ? lookup.ilike("match_counterparty", likeEscape(cp)) : lookup.is("match_counterparty", null);
  const { data: existing } = await lookup.maybeSingle();

  if (existing?.id) {
    await supabase
      .from("category_rules")
      .update({ category_slug: slug, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("category_rules").insert({
      org_id: orgId,
      match_field: "description",
      match_type: "exact",
      match_value: value,
      match_counterparty: cp,
      category_slug: slug,
      priority: 40, // above counterparty (50) → a specific description wins over the merchant
      source: "manual",
    });
  }
}

/**
 * Persist a manual categorization as a durable counterparty rule so the SAME
 * counterparty auto-applies next time (the "memory" that makes categorization
 * sticky). Upsert-by-hand because the uniqueness guard is an expression index
 * (lower(match_value)), which PostgREST's onConflict can't target.
 * NOTE: no longer used by the manual-assign flow (which now remembers by exact
 * description via rememberDescriptionRule); retained for the 462 pre-existing
 * counterparty rules + any programmatic callers.
 */
export async function rememberCounterpartyRule(
  orgId: string,
  counterparty: string,
  slug: string,
  supabase: SupabaseClient
): Promise<void> {
  const value = counterparty.trim();
  if (!value) return;

  const { data: existing } = await supabase
    .from("category_rules")
    .select("id")
    .eq("org_id", orgId)
    .eq("match_field", "counterparty")
    .eq("match_type", "exact")
    .ilike("match_value", likeEscape(value)) // exact, case-insensitive (wildcards escaped)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("category_rules")
      .update({ category_slug: slug, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabase.from("category_rules").insert({
      org_id: orgId,
      match_field: "counterparty",
      match_type: "exact",
      match_value: value,
      category_slug: slug,
      priority: 50, // between system PG rules (10-20) and the default (100)
      source: "manual",
    });
  }
}
