/**
 * App Store closed-month reconciliation ("report tops up the relay").
 *
 * The relay (Server Notifications V2) is real-time but can under-capture — it only
 * starts when the connector is created, and a dropped notification is silent. The
 * monthly Financial Report is Apple's authoritative, complete record. So when a
 * report period is ingested, we reconcile it against what the relay already booked
 * and top up the SHORTFALL, per (country × sku × status).
 *
 * The report has no transaction id (and aggregates units), so this is a COUNT
 * reconciliation, not a row join: for each (country × sku) in the period we book
 * max(0, report_units − relay_units) rows — never duplicating what the relay has.
 * Idempotent via deterministic external_id + persistTransactions' dedup; FX + INR
 * conversion handled by persistTransactions (enrichRowsWithFx).
 */

import type { createServiceClient } from "@/lib/supabase/server";
import type { NormalizedTransaction } from "@/lib/normalizer";
import { persistTransactions } from "@/lib/connectors/sync";
import { alpha2ToAlpha3 } from "@/lib/connectors/app-store-rates";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

type Line = {
  transaction_date: string | null;
  settlement_date: string | null;
  sku: string | null;
  apple_identifier: string | null;
  country: string;
  quantity: number;
  partner_share: number;
  customer_price: number;
  customer_currency: string | null;
  sale_or_return: string | null;
};

type Unit = { date: string; cp: number; ps: number; cur: string | null; country: string; sku: string; appleId: string | null };

export type ReconcileResult = {
  reportPeriod: string;
  reportUnits: number;
  existing: number;
  booked: number;
};

const effDate = (l: Line) => l.transaction_date || l.settlement_date;

/**
 * Reconcile each given report period against existing app_store transactions in
 * that period's date window and book the shortfall. `periods` come from the just-
 * ingested report files.
 */
export async function reconcileAppStorePeriods(
  supabase: ServiceClient,
  orgId: string,
  connectorId: string,
  periods: { reportPeriod: string; start: string | null; end: string | null }[]
): Promise<ReconcileResult[]> {
  const out: ReconcileResult[] = [];

  for (const p of periods) {
    if (!p.start || !p.end) continue; // can't window without a date range

    // ── Report side: unit pools per (country × sku), within the period window ──
    const lines: Line[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("app_store_financial_lines")
        .select("transaction_date, settlement_date, sku, apple_identifier, country, quantity, partner_share, customer_price, customer_currency, sale_or_return")
        .eq("org_id", orgId)
        .eq("report_period", p.reportPeriod)
        .range(from, from + 999);
      if (error) throw new Error(`[app-store reconcile] read lines: ${error.message}`);
      const batch = (data ?? []) as Line[];
      lines.push(...batch);
      if (batch.length < 1000) break;
    }
    const win = lines.filter(
      (l) => l.sku && l.country && effDate(l) && effDate(l)! >= p.start! && effDate(l)! <= p.end! && l.customer_price !== 0
    );

    const grp = new Map<string, { sales: Unit[]; returns: Unit[] }>();
    let reportUnits = 0;
    for (const l of win) {
      const key = `${l.country}::${l.sku}`;
      if (!grp.has(key)) grp.set(key, { sales: [], returns: [] });
      const g = grp.get(key)!;
      const q = Math.abs(l.quantity) || 1;
      reportUnits += q;
      for (let i = 0; i < q; i++) {
        const u: Unit = { date: effDate(l)!, cp: Math.abs(l.customer_price), ps: Math.abs(l.partner_share), cur: l.customer_currency, country: l.country, sku: l.sku!, appleId: l.apple_identifier };
        (l.sale_or_return === "R" ? g.returns : g.sales).push(u);
      }
    }

    // ── Relay side: existing app_store txns in the window, per key × status ──
    const existing = new Map<string, { completed: number; refunded: number }>();
    let existingTotal = 0;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("transactions")
        .select("status, metadata")
        .eq("org_id", orgId)
        .eq("source", "app_store")
        .gte("transaction_date", p.start)
        .lte("transaction_date", p.end)
        .range(from, from + 999);
      if (error) throw new Error(`[app-store reconcile] read txns: ${error.message}`);
      const batch = (data ?? []) as { status: string; metadata: Record<string, unknown> | null }[];
      for (const t of batch) {
        const a3 = t.metadata?.storefront as string | undefined;
        const sku = t.metadata?.product_id as string | undefined;
        if (!a3 || !sku) continue;
        // storefront is alpha-3; map report country (alpha-2) → alpha-3 for the key.
        const key3 = `${a3}::${sku}`;
        const e = existing.get(key3) ?? { completed: 0, refunded: 0 };
        if (t.status === "refunded") e.refunded++; else e.completed++;
        existing.set(key3, e);
        existingTotal++;
      }
      if (batch.length < 1000) break;
    }

    // ── Shortfall → normalized rows ──
    const rows: NormalizedTransaction[] = [];
    const seq = new Map<string, number>();
    const nextSeq = (k: string) => { const n = seq.get(k) ?? 0; seq.set(k, n + 1); return n; };
    for (const [key, g] of grp) {
      const [country, sku] = key.split("::");
      const a3 = alpha2ToAlpha3(country) ?? country;
      const targetC = Math.max(0, g.sales.length - g.returns.length);
      const targetR = g.returns.length;
      const ex = existing.get(`${a3}::${sku}`) ?? { completed: 0, refunded: 0 };
      const bookC = Math.max(0, targetC - ex.completed);
      const bookR = Math.max(0, targetR - ex.refunded);
      g.sales.sort((a, b) => a.date.localeCompare(b.date));

      const build = (u: Unit, status: "completed" | "refunded"): NormalizedTransaction => ({
        external_id: `appstore_rpt_${status === "refunded" ? "R" : "S"}_${u.country}_${u.sku}_${u.date}_tu_${nextSeq(`${status}:${u.country}:${u.sku}:${u.date}`)}`,
        type: "credit",
        amount: Number(u.cp.toFixed(2)),
        currency: u.cur ?? "USD",
        category: null,
        counterparty_name: null,
        description: `${status === "refunded" ? "REFUND" : "SALE"} · ${u.sku}`,
        source: "app_store",
        status,
        transaction_date: u.date,
        transaction_at: null,
        metadata: {
          product_id: u.sku, storefront: a3, country: u.country, quantity: 1,
          fee: Number((u.cp - u.ps).toFixed(2)), net: Number(u.ps.toFixed(2)),
          apple_identifier: u.appleId, synthetic: true, source_report: "app_store_financial",
        },
      });

      for (let i = 0; i < bookC; i++) rows.push(build(g.sales[i], "completed"));
      for (let i = 0; i < bookR; i++) rows.push(build(g.returns[i], "refunded"));
    }

    let booked = 0;
    if (rows.length > 0) {
      const res = await persistTransactions(supabase, orgId, connectorId, rows);
      booked = res.inserted;
    }
    out.push({ reportPeriod: p.reportPeriod, reportUnits, existing: existingTotal, booked });
  }

  return out;
}
