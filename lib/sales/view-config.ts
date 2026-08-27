import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Sales "view" config: the per-org, shared column/breakdown playground ─────────
// Governs ONLY how descriptive columns (the source columns kept in metadata.raw) are
// presented on the Sales page — which are visible, their order, a display label,
// whether each is a breakdown dimension, and a light type hint. The money fields
// (date/amount) are mapped at connect time and are NOT configurable here, so a view
// change can never affect the ledger math. Stored in view_configs (view_key='sales').

export type SalesColType = "text" | "number" | "date";
export type SalesColumn = {
  key: string;          // metadata.raw column key
  label: string;        // display label (defaults to key)
  visible: boolean;     // shown in the transactions table
  dimension: boolean;   // eligible as a breakdown dimension
  type: SalesColType;   // light type hint (alignment / future sorting)
  order: number;        // display order
};
export type SalesViewConfig = { columns: SalesColumn[] };

const VIEW_KEY = "sales";
const DEFAULT_VISIBLE = 6; // how many detected columns to show before the user curates

/** Light type guess from a column name — a starting point the user can override. */
export function guessSalesColType(key: string): SalesColType {
  const k = key.toLowerCase();
  if (/\b(date|dt|day|created|received|invoice date|order date)\b/.test(k) || /date$/.test(k)) return "date";
  if (/\b(amount|amt|value|price|total|qty|quantity|count|gst|tax|rate|revenue|sales|mrp)\b/.test(k)) return "number";
  return "text";
}

/** Sensible default when the org hasn't curated a view yet. */
export function defaultSalesViewConfig(detected: string[]): SalesViewConfig {
  return {
    columns: detected.map((key, i) => ({
      key,
      label: key,
      visible: i < DEFAULT_VISIBLE,
      dimension: true, // every detected column is breakdown-eligible until curated
      type: guessSalesColType(key),
      order: i,
    })),
  };
}

/**
 * Merge a saved config with the currently-detected columns: keep the user's curated
 * order/labels/flags, and APPEND any newly-detected columns as hidden — so a new sheet
 * column never barges into a curated view, but is still discoverable in the panel.
 * With no saved config, fall back to the default.
 */
export function mergeSalesViewConfig(saved: SalesViewConfig | null | undefined, detected: string[]): SalesViewConfig {
  if (!saved?.columns?.length) return defaultSalesViewConfig(detected);
  const known = new Set(saved.columns.map((c) => c.key));
  const cols: SalesColumn[] = saved.columns.map((c) => ({
    key: c.key,
    label: c.label || c.key,
    visible: Boolean(c.visible),
    dimension: Boolean(c.dimension),
    type: (["text", "number", "date"] as const).includes(c.type) ? c.type : guessSalesColType(c.key),
    order: Number.isFinite(c.order) ? c.order : 0,
  }));
  let next = cols.reduce((m, c) => Math.max(m, c.order), -1) + 1;
  for (const key of detected) {
    if (!known.has(key)) cols.push({ key, label: key, visible: false, dimension: true, type: guessSalesColType(key), order: next++ });
  }
  return { columns: cols.sort((a, b) => a.order - b.order) };
}

/** Read the org's saved sales view config. Null if none / table not yet applied. */
export async function getSalesViewConfig(orgId: string, supabase: SupabaseClient): Promise<SalesViewConfig | null> {
  try {
    const { data } = await supabase
      .from("view_configs")
      .select("config")
      .eq("org_id", orgId)
      .eq("view_key", VIEW_KEY)
      .limit(1)
      .maybeSingle();
    const cfg = data?.config as SalesViewConfig | undefined;
    return cfg?.columns ? cfg : null;
  } catch {
    // Table missing (migration not applied) must never break the page.
    return null;
  }
}

/** Upsert the org's sales view config (called from the access-checked API route). */
export async function saveSalesViewConfig(orgId: string, config: SalesViewConfig, supabase: SupabaseClient): Promise<void> {
  await supabase
    .from("view_configs")
    .upsert(
      { org_id: orgId, view_key: VIEW_KEY, config: config as unknown as Record<string, unknown>, updated_at: new Date().toISOString() },
      { onConflict: "org_id,view_key" }
    );
}
