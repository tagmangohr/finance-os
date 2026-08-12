import type { SupabaseClient } from "@supabase/supabase-js";
import { SUB_DEFAULT_PINNED, SUB_DEFAULT_VISIBLE_COUNT, SUB_METRICS_BY_KEY, SUB_VISIBLE_COUNT_OPTIONS } from "./metric-registry";

export type SubMetricPrefs = { pinned: string[]; visibleCount: number };

export function subDefaultPrefs(): SubMetricPrefs {
  return { pinned: [...SUB_DEFAULT_PINNED], visibleCount: SUB_DEFAULT_VISIBLE_COUNT };
}

/** Drop unknown keys, de-dupe, clamp count to an allowed option. */
export function sanitizeSubPrefs(pinned: unknown, visibleCount: unknown): SubMetricPrefs {
  const keys = Array.isArray(pinned)
    ? [...new Set(pinned.filter((k): k is string => typeof k === "string" && !!SUB_METRICS_BY_KEY[k]))]
    : [];
  const count = SUB_VISIBLE_COUNT_OPTIONS.includes(Number(visibleCount)) ? Number(visibleCount) : SUB_DEFAULT_VISIBLE_COUNT;
  return { pinned: keys.length ? keys : [...SUB_DEFAULT_PINNED], visibleCount: count };
}

/**
 * A user's per-org subscription-strip preferences. A missing table (migration 066
 * not applied) or missing row falls back to defaults — never throws.
 */
export async function getSubMetricPrefs(userId: string, orgId: string, supabase: SupabaseClient): Promise<SubMetricPrefs> {
  try {
    const { data, error } = await supabase
      .from("user_subscription_metric_prefs")
      .select("pinned_metric_keys, visible_count")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error || !data) return subDefaultPrefs();
    return sanitizeSubPrefs(data.pinned_metric_keys, data.visible_count);
  } catch {
    return subDefaultPrefs();
  }
}
