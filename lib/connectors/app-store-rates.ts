/**
 * App Store payout-rate lookup + live fee stamping.
 *
 * The relay carries the customer's storefront as an ISO alpha-3 code
 * (metadata.storefront, e.g. "USA") and the SKU as metadata.product_id. The rate
 * table (app_store_payout_rates, built from the Financial Report — see
 * app-store-report.ts) is keyed on those, so we can attribute a per-transaction
 * fee = amount × (1 − payout_ratio) the moment a notification lands, then true it
 * up when the month's report is ingested. See migration 072.
 */

import type { createServiceClient } from "@/lib/supabase/server";
import type { NormalizedTransaction } from "@/lib/normalizer";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

// ── ISO-3166 alpha-2 → alpha-3 ────────────────────────────────────────────────
// Report uses alpha-2 (Country of Sale); the relay's storefront is alpha-3. Covers
// every storefront present in Fiesta's reports plus common others; unknown → null
// (that (country×sku) simply won't attribute a fee until mapped — safe, not wrong).
const ALPHA2_TO_ALPHA3: Record<string, string> = {
  AE: "ARE", AU: "AUS", AT: "AUT", BE: "BEL", BH: "BHR", BR: "BRA", CA: "CAN",
  CH: "CHE", CL: "CHL", CN: "CHN", CO: "COL", CY: "CYP", CZ: "CZE", DE: "DEU",
  DK: "DNK", EG: "EGY", ES: "ESP", FI: "FIN", FJ: "FJI", FR: "FRA", GB: "GBR",
  GR: "GRC", HK: "HKG", HR: "HRV", HU: "HUN", ID: "IDN", IE: "IRL", IL: "ISR",
  IN: "IND", IS: "ISL", IT: "ITA", JP: "JPN", KR: "KOR", KW: "KWT", LK: "LKA",
  LU: "LUX", MV: "MDV", MX: "MEX", MY: "MYS", MZ: "MOZ", NG: "NGA", NL: "NLD",
  NO: "NOR", NP: "NPL", NZ: "NZL", OM: "OMN", PH: "PHL", PK: "PAK", PL: "POL",
  PT: "PRT", QA: "QAT", RO: "ROU", RU: "RUS", SA: "SAU", SE: "SWE", SG: "SGP",
  TH: "THA", TR: "TUR", TW: "TWN", TZ: "TZA", UA: "UKR", US: "USA", VN: "VNM",
  ZA: "ZAF",
};

export function alpha2ToAlpha3(a2: string): string | null {
  return ALPHA2_TO_ALPHA3[(a2 || "").toUpperCase()] ?? null;
}

// ── Cached rate map (per server instance, short TTL) ──────────────────────────
type RateMap = Map<string, number>; // key `${alpha3}:${sku}` → payout_ratio
let cache: { orgId: string; at: number; map: RateMap } | null = null;
const TTL_MS = 60_000;

async function loadRates(supabase: ServiceClient, orgId: string): Promise<RateMap> {
  if (cache && cache.orgId === orgId && Date.now() - cache.at < TTL_MS) return cache.map;
  const map: RateMap = new Map();
  try {
    const { data } = await supabase
      .from("app_store_payout_rates")
      .select("country_alpha3, sku, payout_ratio")
      .eq("org_id", orgId);
    for (const r of (data ?? []) as { country_alpha3: string | null; sku: string; payout_ratio: number }[]) {
      if (r.country_alpha3 && r.sku) map.set(`${r.country_alpha3}:${r.sku}`, Number(r.payout_ratio));
    }
  } catch {
    // Best-effort: a lookup failure just means no fee is stamped this time.
  }
  cache = { orgId, at: Date.now(), map };
  return map;
}

/**
 * Stamp metadata.fee onto a normalized App Store transaction from the derived
 * rates. Best-effort and fill-only: never overwrites an existing fee, never throws,
 * and leaves the row untouched when the (storefront × sku) rate isn't known yet
 * (the next report ingest will backfill it via backfill_app_store_fees).
 */
export async function stampAppStoreFee(
  supabase: ServiceClient,
  orgId: string,
  txn: NormalizedTransaction
): Promise<void> {
  try {
    if (!txn || txn.amount == null || txn.amount <= 0) return;
    const meta = (txn.metadata ?? {}) as Record<string, unknown>;
    if (meta.fee != null) return; // already priced
    const storefront = typeof meta.storefront === "string" ? meta.storefront : null;
    const sku = typeof meta.product_id === "string" ? meta.product_id : null;
    if (!storefront || !sku) return;

    const map = await loadRates(supabase, orgId);
    const ratio = map.get(`${storefront}:${sku}`);
    if (ratio == null || !(ratio > 0 && ratio <= 1)) return;

    const fee = Number((txn.amount * (1 - ratio)).toFixed(2));
    txn.metadata = { ...meta, fee } as NormalizedTransaction["metadata"];
  } catch {
    // Non-fatal — booking the transaction must not depend on fee attribution.
  }
}
