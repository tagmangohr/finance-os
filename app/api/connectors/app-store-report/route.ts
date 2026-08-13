import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireConnectorAccess } from "@/lib/api/auth";
import {
  parseAppStoreReport,
  derivePayoutRates,
  type AppStoreLine,
  type RateInput,
} from "@/lib/connectors/app-store-report";
import { reconcileAppStorePeriods } from "@/lib/connectors/app-store-history";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type LineInsert = Database["public"]["Tables"]["app_store_financial_lines"]["Insert"];
type RateInsert = Database["public"]["Tables"]["app_store_payout_rates"]["Insert"];

const CHUNK = 500;
async function insertChunked<T>(
  rows: T[],
  fn: (batch: T[]) => PromiseLike<{ error: { message: string } | null }>
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await fn(rows.slice(i, i + CHUNK));
    if (error) throw new Error(error.message);
  }
}

/**
 * POST /api/connectors/app-store-report
 * Multipart form: org_id, connector_id (the app_store connector), file (one or many TSVs).
 *
 * Ingests Apple Financial Reports: parses each file, replaces that report period's
 * lines (idempotent), rebuilds the (country × sku) payout-rate table from ALL the
 * org's lines, then attributes metadata.fee onto existing app_store transactions.
 * Admin/manager-gated via requireConnectorAccess.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse multipart form data" }, { status: 400 });
  }

  const orgId = formData.get("org_id");
  const connectorId = formData.get("connector_id");
  if (!orgId || typeof orgId !== "string") {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }
  if (!connectorId || typeof connectorId !== "string") {
    return NextResponse.json({ error: "connector_id is required" }, { status: 400 });
  }

  const files = formData.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "at least one file is required" }, { status: 400 });
  }

  const auth = await requireConnectorAccess(connectorId, { orgId, type: "app_store" });
  if (isAuthFailure(auth)) return auth.error;
  const { supabase, org, connector } = auth;

  const perFile: { name: string; period: string; inserted: number; skipped: number }[] = [];
  const periods = new Map<string, { reportPeriod: string; start: string | null; end: string | null }>();

  try {
    // ── 1. Parse + replace-by-period for each file ──────────────────────────
    for (const file of files) {
      const text = await file.text();
      const parsed = parseAppStoreReport(text);
      if (parsed.lines.length === 0) {
        perFile.push({ name: file.name, period: parsed.reportPeriod, inserted: 0, skipped: parsed.skipped });
        continue;
      }
      periods.set(parsed.reportPeriod, { reportPeriod: parsed.reportPeriod, start: parsed.periodStart, end: parsed.periodEnd });

      // Idempotent: drop this period's existing rows before reinserting.
      const { error: delErr } = await supabase
        .from("app_store_financial_lines")
        .delete()
        .eq("org_id", org.id)
        .eq("report_period", parsed.reportPeriod);
      if (delErr) throw new Error(`delete period ${parsed.reportPeriod}: ${delErr.message}`);

      const rows: LineInsert[] = parsed.lines.map((l: AppStoreLine) => ({
        ...l,
        org_id: org.id,
        connector_id: connector.id,
      }));
      await insertChunked(rows, (batch) => supabase.from("app_store_financial_lines").insert(batch));
      perFile.push({ name: file.name, period: parsed.reportPeriod, inserted: rows.length, skipped: parsed.skipped });
    }

    // ── 2. Rebuild the payout-rate table from ALL the org's lines ───────────
    const rateInputs: RateInput[] = [];
    {
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("app_store_financial_lines")
          .select("country, sku, sale_or_return, quantity, partner_share, extended_partner_share, customer_price, customer_currency, partner_currency")
          .eq("org_id", org.id)
          .eq("sale_or_return", "S")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`read lines for rates: ${error.message}`);
        const batch = (data ?? []) as RateInput[];
        rateInputs.push(...batch);
        if (batch.length < PAGE) break;
      }
    }
    const rates = derivePayoutRates(rateInputs);

    // Full replace: rates are fully derived from the lines.
    const { error: delRatesErr } = await supabase
      .from("app_store_payout_rates")
      .delete()
      .eq("org_id", org.id);
    if (delRatesErr) throw new Error(`clear rates: ${delRatesErr.message}`);

    const rateRows: RateInsert[] = rates.map((r) => ({ ...r, org_id: org.id }));
    if (rateRows.length > 0) {
      await insertChunked(rateRows, (batch) => supabase.from("app_store_payout_rates").insert(batch));
    }

    // ── 3. Attribute metadata.fee onto existing app_store transactions ──────
    let feesBackfilled = 0;
    {
      const { data, error } = await supabase.rpc(
        "backfill_app_store_fees" as never,
        { p_org: org.id, p_overwrite: false } as never
      );
      if (error) throw new Error(`backfill fees: ${error.message}`);
      feesBackfilled = typeof data === "number" ? data : 0;
    }

    // ── 4. Reconcile each ingested period against the relay + top up shortfall ──
    // The relay can under-capture (it only starts when connected, and drops are
    // silent). The report is Apple's authoritative record, so book any missing
    // units per (country × sku) — a COUNT top-up that never duplicates relay rows.
    const reconciled = await reconcileAppStorePeriods(
      supabase, org.id, connector.id, [...periods.values()]
    );

    return NextResponse.json({
      ok: true,
      files: perFile,
      rates: rateRows.length,
      fees_backfilled: feesBackfilled,
      reconciled,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to ingest App Store report" },
      { status: 500 }
    );
  }
}
