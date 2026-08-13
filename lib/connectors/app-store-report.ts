/**
 * Parser for Apple's App Store "Financial Report" (the tab-separated monthly
 * payout report from App Store Connect → Payments and Financial Reports).
 *
 * Why this exists: the relay (App Store Server Notifications V2) only carries the
 * CUSTOMER PRICE — never Apple's commission/proceeds. This report is the only
 * place Apple discloses net proceeds (Partner Share), so we ingest it to (a) keep
 * exact aggregates and (b) derive a (country × sku) payout ratio that attributes a
 * per-transaction fee onto relay rows. See migration 072 and app-store-rates.ts.
 *
 * File shape (real Apple export):
 *   Vendor Name\tTagMango Inc
 *   Start Date\t11/30/2025
 *   End Date\t12/27/2025
 *   <TAB-separated column header row>
 *   <data rows…>
 *   Country Of Sale\tPartner Share Currency\tQuantity\tExtended Partner Share   ← summary block, ignored
 *   <per-country totals…>
 */

import { alpha2ToAlpha3 } from "./app-store-rates";

/** One parsed data row, ready to insert into app_store_financial_lines. */
export type AppStoreLine = {
  report_period: string;
  period_start: string | null;
  period_end: string | null;
  transaction_date: string | null;
  settlement_date: string | null;
  apple_identifier: string | null;
  sku: string | null;
  title: string | null;
  product_type: string | null;
  country: string;
  quantity: number;
  partner_share: number;
  extended_partner_share: number;
  partner_currency: string | null;
  customer_price: number;
  customer_currency: string | null;
  sale_or_return: string | null;
  promo_code: string | null;
  order_type: string | null;
  region: string | null;
};

export type ParsedAppStoreReport = {
  reportPeriod: string;
  periodStart: string | null;
  periodEnd: string | null;
  lines: AppStoreLine[];
  /** Rows that looked like data but failed to parse (kept for the upload summary). */
  skipped: number;
};

/** One derived payout rate for a (country × sku) pair. */
export type AppStorePayoutRate = {
  country_alpha2: string;
  country_alpha3: string | null;
  sku: string;
  payout_ratio: number;
  sample_customer_price: number;
  sample_partner_share: number;
  currency: string | null;
  units: number;
};

// MM/DD/YYYY → YYYY-MM-DD (Apple's report date format). Blank/invalid → null.
function toISODate(s: string | undefined): string | null {
  const v = (s ?? "").trim();
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function toNum(s: string | undefined): number {
  const n = Number((s ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse a raw App Store Financial Report (TSV text) into line items. Header
 * preamble and the trailing per-country summary block are skipped. The report
 * period is the ISO date range from the Start/End header rows — stable and unique
 * per report, so a re-upload replaces the same period (idempotent).
 */
export function parseAppStoreReport(text: string): ParsedAppStoreReport {
  const rows = text.split(/\r?\n/).map((l) => l.split("\t"));

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  const lines: AppStoreLine[] = [];
  let skipped = 0;

  for (const cols of rows) {
    const first = (cols[0] ?? "").trim();

    // Header preamble.
    if (first === "Start Date") { periodStart = toISODate(cols[1]); continue; }
    if (first === "End Date") { periodEnd = toISODate(cols[1]); continue; }
    if (first === "Vendor Name") continue;
    // Column header row and the trailing country-summary block → stop treating as data.
    if (first === "Transaction Date") continue;
    if (first === "Country Of Sale" || first === "Country of Sale") break;
    if (cols.length === 1 && first === "") continue; // blank line

    // A real data row has the full column set and an S/R marker in column 14.
    const saleOrReturn = (cols[14] ?? "").trim().toUpperCase();
    if (cols.length < 15 || (saleOrReturn !== "S" && saleOrReturn !== "R")) {
      if (first !== "") skipped++;
      continue;
    }

    lines.push({
      report_period: "", // filled after we know the range
      period_start: null,
      period_end: null,
      transaction_date: toISODate(cols[0]),
      settlement_date: toISODate(cols[1]),
      apple_identifier: (cols[2] ?? "").trim() || null,
      sku: (cols[3] ?? "").trim() || null,
      title: (cols[4] ?? "").trim() || null,
      product_type: (cols[6] ?? "").trim() || null,
      country: (cols[7] ?? "").trim().toUpperCase(),
      quantity: Math.trunc(toNum(cols[8])),
      partner_share: toNum(cols[9]),
      extended_partner_share: toNum(cols[10]),
      partner_currency: (cols[11] ?? "").trim().toUpperCase() || null,
      customer_price: toNum(cols[12]),
      customer_currency: (cols[13] ?? "").trim().toUpperCase() || null,
      sale_or_return: saleOrReturn,
      promo_code: (cols[15] ?? "").trim() || null,
      order_type: (cols[16] ?? "").trim() || null,
      region: (cols[17] ?? "").trim() || null,
    });
  }

  const reportPeriod = `${periodStart ?? "?"}..${periodEnd ?? "?"}`;
  for (const l of lines) {
    l.report_period = reportPeriod;
    l.period_start = periodStart;
    l.period_end = periodEnd;
  }

  return { reportPeriod, periodStart, periodEnd, lines, skipped };
}

/** The subset of a line needed to derive a rate (parsed lines OR DB rows both fit). */
export type RateInput = Pick<
  AppStoreLine,
  | "country" | "sku" | "sale_or_return" | "quantity"
  | "partner_share" | "extended_partner_share" | "customer_price"
  | "customer_currency" | "partner_currency"
>;

/**
 * Derive one effective payout ratio per (country × sku) from parsed lines. Only
 * SALE rows (S) with a positive price and matching customer/partner currency count
 * — a returns row or a currency mismatch would skew the fraction. The ratio is
 * units-weighted: Σ(extended_partner_share) / Σ(customer_price × quantity).
 */
export function derivePayoutRates(lines: RateInput[]): AppStorePayoutRate[] {
  type Acc = {
    country: string; sku: string; currency: string | null;
    grossSum: number; netSum: number; units: number;
    sampleCP: number; samplePS: number; sampleUnits: number;
  };
  const byKey = new Map<string, Acc>();

  for (const l of lines) {
    if (l.sale_or_return !== "S") continue;
    if (!l.sku || !l.country) continue;
    if (l.customer_price <= 0 || l.quantity <= 0) continue;
    // Ratio is only meaningful within one currency.
    if (l.customer_currency && l.partner_currency && l.customer_currency !== l.partner_currency) continue;

    const key = `${l.country}::${l.sku}`;
    const gross = l.customer_price * l.quantity;
    const net = l.extended_partner_share;
    const acc = byKey.get(key);
    if (!acc) {
      byKey.set(key, {
        country: l.country, sku: l.sku, currency: l.customer_currency,
        grossSum: gross, netSum: net, units: l.quantity,
        sampleCP: l.customer_price, samplePS: l.partner_share, sampleUnits: l.quantity,
      });
    } else {
      acc.grossSum += gross;
      acc.netSum += net;
      acc.units += l.quantity;
      // Keep the sample from the highest-volume row for readability.
      if (l.quantity > acc.sampleUnits) {
        acc.sampleUnits = l.quantity;
        acc.sampleCP = l.customer_price;
        acc.samplePS = l.partner_share;
      }
    }
  }

  const out: AppStorePayoutRate[] = [];
  for (const acc of byKey.values()) {
    if (acc.grossSum <= 0) continue;
    const ratio = acc.netSum / acc.grossSum;
    // Guard against nonsense (a bad row producing a ratio >1 or <0).
    if (!(ratio > 0 && ratio <= 1)) continue;
    out.push({
      country_alpha2: acc.country,
      country_alpha3: alpha2ToAlpha3(acc.country),
      sku: acc.sku,
      payout_ratio: Number(ratio.toFixed(6)),
      sample_customer_price: acc.sampleCP,
      sample_partner_share: acc.samplePS,
      currency: acc.currency,
      units: acc.units,
    });
  }
  return out;
}
