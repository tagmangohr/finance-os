import type { SupabaseClient } from "@supabase/supabase-js";
import { BASE_CURRENCY } from "@/lib/utils";

/**
 * Foreign-exchange conversion to the base currency (INR).
 *
 * Needed because the Stripe account settles in USD (US account) — Stripe never
 * touches INR, so it can't provide a USD→INR rate. We use the ECB daily reference
 * rates via frankfurter.app (free, no API key, historical) and convert each
 * transaction at its own date.
 */

type RatesByDate = Map<string, number>; // YYYY-MM-DD -> (1 unit of currency in INR)

// Per-process memo so repeated lookups in one sync don't refetch. Serverless
// invocations are short-lived, so this is a within-request cache, not persistent.
const memo = new Map<string, RatesByDate>();

// The CONTIGUOUS date span already fetched into `memo` per currency. We fetch by
// range (frankfurter returns every business day in [from,to]), so once a span is
// fetched, nearestPrior over the memo yields the true nearest-prior rate for any
// date inside it. Tracking the span — instead of asking "does the memo hold SOME
// earlier rate?" — is what stops a date from anchoring to a stale rate that
// predates it (the bug that made every date collapse to one early rate).
const covered = new Map<string, { from: string; to: string }>();

// Canonical host (the old api.frankfurter.app now 301-redirects here and needs
// the /v1 prefix). Pinning it avoids depending on a redirect that could break.
const FX_BASE = "https://api.frankfurter.dev/v1";

// How many calendar days to extend a fetch BEFORE the earliest needed date, so a
// date that falls on a market holiday/weekend always has a prior business-day rate
// inside the fetched range. Covers any normal ECB closure cluster (Easter, etc.).
const LOOKBACK_DAYS = 10;

/** `isoDate` (YYYY-MM-DD) minus `days`, as YYYY-MM-DD (UTC). */
function minusDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Fetch a date range of `currency`→INR rates (business days only). */
async function fetchRange(currency: string, minDate: string, maxDate: string): Promise<RatesByDate> {
  const url = `${FX_BASE}/${minDate}..${maxDate}?from=${currency}&to=${BASE_CURRENCY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`FX fetch failed ${res.status} for ${currency}`);
  const json = (await res.json()) as { rates?: Record<string, Record<string, number>> };
  const map: RatesByDate = new Map();
  for (const [d, obj] of Object.entries(json.rates ?? {})) {
    const r = obj?.[BASE_CURRENCY];
    if (typeof r === "number") map.set(d, r);
  }
  return map;
}

/** Rate for `date`, or the most recent PRIOR business day (markets close on
 *  weekends/holidays; today's rate may not be published yet). Returns null if no
 *  prior date is in `rates` — NEVER a future date. Anchoring a past transaction to
 *  a future rate (the old `earliest` fallback) made the same calendar day resolve
 *  to different rates depending on which range a sync run happened to fetch. */
function nearestPrior(rates: RatesByDate, date: string): number | null {
  if (rates.has(date)) return rates.get(date)!;
  let best: string | null = null;
  for (const d of rates.keys()) {
    if (d <= date && (best === null || d > best)) best = d;
  }
  return best ? rates.get(best)! : null;
}

/** Map of date → (currency→INR) rate for the requested dates. INR is 1:1. */
export async function getInrRates(currency: string, dates: string[]): Promise<Map<string, number>> {
  if (currency === BASE_CURRENCY) return new Map(dates.map((d) => [d, 1]));
  const uniq = Array.from(new Set(dates)).sort();
  if (uniq.length === 0) return new Map();

  // We need every business day in [earliest − LOOKBACK_DAYS, latest] so each date
  // can resolve to its TRUE nearest-prior rate (the −LOOKBACK guarantees a prior
  // anchor exists even when the earliest date is a weekend/holiday like 1 May).
  const needFrom = minusDays(uniq[0], LOOKBACK_DAYS);
  const needTo = uniq[uniq.length - 1];
  const rates = memo.get(currency) ?? new Map<string, number>();
  const cov = covered.get(currency);

  // Fetch only when the needed span isn't already covered. Fetch the UNION of the
  // covered span and the needed span so the memo stays one contiguous range — a
  // single range request covers it, and re-fetching any overlap is harmless.
  if (!cov || needFrom < cov.from || needTo > cov.to) {
    const from = cov && cov.from < needFrom ? cov.from : needFrom;
    const to = cov && cov.to > needTo ? cov.to : needTo;
    try {
      const fetched = await fetchRange(currency, from, to);
      for (const [d, r] of fetched) rates.set(d, r);
      memo.set(currency, rates);
      covered.set(currency, { from, to });
    } catch {
      // Leave amount_base null on failure — aggregation falls back to amount and a
      // later sync retries, rather than storing a wrong (un-converted) figure.
    }
  }

  const out = new Map<string, number>();
  for (const d of uniq) {
    const r = nearestPrior(rates, d);
    if (r != null) out.set(d, r);
  }
  return out;
}

type FxRow = {
  amount: number;
  currency: string;
  transaction_date: string;
  amount_base?: number | null;
  base_currency?: string | null;
  fx_rate?: number | null;
};

/**
 * Fill amount_base/base_currency/fx_rate on rows that still lack a base-currency
 * value and aren't already in the base currency. Mutates rows in place. One FX
 * fetch per distinct currency (a range covering all its dates).
 */
export async function enrichRowsWithFx(rows: FxRow[]): Promise<void> {
  const need = rows.filter(
    (r) => r.amount_base == null && r.currency && r.currency !== BASE_CURRENCY
  );
  if (need.length === 0) return;

  const byCurrency = new Map<string, FxRow[]>();
  for (const r of need) {
    const list = byCurrency.get(r.currency) ?? [];
    list.push(r);
    byCurrency.set(r.currency, list);
  }

  for (const [currency, rs] of byCurrency) {
    const rateMap = await getInrRates(currency, rs.map((r) => r.transaction_date.slice(0, 10)));
    for (const r of rs) {
      const rate = rateMap.get(r.transaction_date.slice(0, 10));
      if (rate != null) {
        r.amount_base = Math.round(r.amount * rate * 100) / 100;
        r.base_currency = BASE_CURRENCY;
        r.fx_rate = rate;
      }
    }
  }
}

/**
 * Convert EXISTING transaction rows that still lack a base-currency value.
 * Works directly on the DB (no gateway re-fetch needed — the charges are already
 * stored, only amount_base is missing), so it's fast and can't time out the way a
 * full re-sync does. Idempotent + resumable: each run drains a bounded batch and
 * reports how many rows still need conversion.
 */
export async function backfillMissingBaseAmounts(
  supabase: SupabaseClient,
  maxRows = 3000
): Promise<{ updated: number; remaining: number }> {
  const { data: rows } = await supabase
    .from("transactions")
    .select("id, amount, currency, transaction_date")
    .is("amount_base", null)
    .not("currency", "is", null)
    .neq("currency", BASE_CURRENCY)
    .limit(maxRows);

  if (!rows || rows.length === 0) return { updated: 0, remaining: 0 };

  const byCurrency = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCurrency.get(r.currency) ?? [];
    list.push(r);
    byCurrency.set(r.currency, list);
  }

  let updated = 0;
  for (const [currency, rs] of byCurrency) {
    const rateMap = await getInrRates(currency, rs.map((r) => String(r.transaction_date).slice(0, 10)));
    for (let i = 0; i < rs.length; i += 100) {
      const chunk = rs.slice(i, i + 100);
      await Promise.all(
        chunk.map(async (r) => {
          const rate = rateMap.get(String(r.transaction_date).slice(0, 10));
          if (rate == null) return;
          const { error } = await supabase
            .from("transactions")
            .update({
              amount_base: Math.round(Number(r.amount) * rate * 100) / 100,
              base_currency: BASE_CURRENCY,
              fx_rate: rate,
            })
            .eq("id", r.id);
          if (!error) updated++;
        })
      );
    }
  }

  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .is("amount_base", null)
    .not("currency", "is", null)
    .neq("currency", BASE_CURRENCY);

  return { updated, remaining: count ?? 0 };
}
