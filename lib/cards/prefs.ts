import type { SupabaseClient } from "@supabase/supabase-js";

export type CardPrefs = { order: string[]; hidden: string[] };

export const EMPTY_CARD_PREFS: CardPrefs = { order: [], hidden: [] };

/** Keep only strings; de-dupe. `validKeys` (when given) drops keys that no longer
 *  exist on the tab, so a removed/renamed card can never wedge the layout. */
export function sanitizeCardPrefs(order: unknown, hidden: unknown, validKeys?: readonly string[]): CardPrefs {
  const ok = (k: unknown): k is string =>
    typeof k === "string" && (!validKeys || validKeys.includes(k));
  const cleanOrder = Array.isArray(order) ? [...new Set(order.filter(ok))] : [];
  const cleanHidden = Array.isArray(hidden) ? [...new Set(hidden.filter(ok))] : [];
  return { order: cleanOrder, hidden: cleanHidden };
}

/**
 * A user's card layout for one tab in one org. A missing table (migration 121 not
 * applied) or missing row falls back to the empty prefs (default order, nothing
 * hidden) — never throws, so a tab always renders.
 */
export async function getCardPrefs(
  userId: string,
  orgId: string,
  tab: string,
  supabase: SupabaseClient
): Promise<CardPrefs> {
  try {
    const { data, error } = await supabase
      .from("user_card_prefs")
      .select("card_order, hidden")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .eq("tab", tab)
      .maybeSingle();
    if (error || !data) return EMPTY_CARD_PREFS;
    return sanitizeCardPrefs(data.card_order, data.hidden);
  } catch {
    return EMPTY_CARD_PREFS;
  }
}
