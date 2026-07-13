import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PINNED, DEFAULT_VISIBLE_COUNT, METRICS_BY_KEY, VISIBLE_COUNT_OPTIONS } from "./registry";

export type MetricPrefs = { pinned: string[]; visibleCount: number };

export function defaultPrefs(): MetricPrefs {
  return { pinned: [...DEFAULT_PINNED], visibleCount: DEFAULT_VISIBLE_COUNT };
}

/** Drop unknown keys, de-dupe, clamp count to an allowed option. */
export function sanitizePrefs(pinned: unknown, visibleCount: unknown): MetricPrefs {
  const keys = Array.isArray(pinned)
    ? [...new Set(pinned.filter((k): k is string => typeof k === "string" && !!METRICS_BY_KEY[k]))]
    : [];
  const count = VISIBLE_COUNT_OPTIONS.includes(Number(visibleCount)) ? Number(visibleCount) : DEFAULT_VISIBLE_COUNT;
  return { pinned: keys.length ? keys : [...DEFAULT_PINNED], visibleCount: count };
}

/**
 * A user's per-org metric preferences. A missing table (migration 029 not applied
 * yet) or missing row falls back to sensible defaults — never throws, so the
 * dashboard renders regardless.
 */
export async function getMetricPrefs(userId: string, orgId: string, supabase: SupabaseClient): Promise<MetricPrefs> {
  try {
    const { data, error } = await supabase
      .from("user_metric_prefs")
      .select("pinned_metric_keys, visible_count")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error || !data) return defaultPrefs();
    return sanitizePrefs(data.pinned_metric_keys, data.visible_count);
  } catch {
    return defaultPrefs();
  }
}
