import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { RazorpayConnector } from "@/lib/connectors/razorpay";
import { StripeConnector } from "@/lib/connectors/stripe";
import { NormalizedTransaction } from "@/lib/normalizer";
import { getExistingExternalIds } from "@/lib/db/dedup";
import type { Database } from "@/lib/supabase/types";

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

export type SyncResult = {
  connector_id: string;
  connector_name: string;
  type: string;
  fetched: number;      // total transactions returned by the API
  inserted: number;     // new rows actually added to DB
  skipped: number;      // already existed — not re-inserted
  from: string;
  to: string;
  error?: string;
  warnings?: string[];  // non-fatal per-endpoint failures (e.g. payouts not activated)
};

// ─── POST /api/sync ───────────────────────────────────────────────────────────
// Body: { org_id: string; from_date?: string; to_date?: string }

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string; from_date?: string; to_date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { org_id, from_date, to_date } = body;
  if (!org_id) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // ── Fetch all active connectors ───────────────────────────────────────────
  const { data: connectors, error: connErr } = await supabase
    .from("connectors")
    .select("*")
    .eq("org_id", org_id)
    .eq("status", "active")
    .in("type", ["razorpay", "stripe"]);

  if (connErr) {
    return NextResponse.json(
      { error: "Failed to fetch connectors", details: connErr.message },
      { status: 500 }
    );
  }

  if (!connectors || connectors.length === 0) {
    return NextResponse.json({ results: [], total_fetched: 0, total_inserted: 0, total_skipped: 0 });
  }

  // ── Resolve date range ────────────────────────────────────────────────────
  const toDate = to_date ? new Date(to_date) : new Date();
  const fromDate = from_date
    ? new Date(from_date)
    : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── Sync each connector in parallel ──────────────────────────────────────
  const results = await Promise.all(
    connectors.map((c: ConnectorRow) => syncConnector(c, org_id, fromDate, toDate, supabase))
  );

  const total_fetched = results.reduce((s, r) => s + r.fetched, 0);
  const total_inserted = results.reduce((s, r) => s + r.inserted, 0);
  const total_skipped = results.reduce((s, r) => s + r.skipped, 0);

  return NextResponse.json({
    results,
    total_fetched,
    total_inserted,
    total_skipped,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  });
}

// ─── Per-connector sync ───────────────────────────────────────────────────────

async function syncConnector(
  connector: ConnectorRow,
  orgId: string,
  fromDate: Date,
  toDate: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<SyncResult> {
  const result: SyncResult = {
    connector_id: connector.id,
    connector_name: connector.name,
    type: connector.type,
    fetched: 0,
    inserted: 0,
    skipped: 0,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };

  try {
    const config = connector.config as Record<string, string>;
    let transactions: NormalizedTransaction[] = [];

    if (connector.type === "razorpay") {
      const { key_id, key_secret } = config;
      if (!key_id || !key_secret) throw new Error("Missing key_id or key_secret");
      const razorpay = new RazorpayConnector(key_id, key_secret);

      const [paymentsRes, payoutsRes, refundsRes, settlementsRes, disputesRes] =
        await Promise.allSettled([
          razorpay.fetchPayments(fromDate, toDate),
          razorpay.fetchPayouts(fromDate, toDate),
          razorpay.fetchRefunds(fromDate, toDate),
          razorpay.fetchSettlements(fromDate, toDate),
          razorpay.fetchDisputes(fromDate, toDate),
        ]);

      const addWarning = (label: string, reason: unknown) => {
        const msg = reason instanceof Error ? reason.message : String(reason);
        // Trim verbose API body — keep first 120 chars
        result.warnings = [
          ...(result.warnings ?? []),
          `${label}: ${msg.slice(0, 120)}`,
        ];
      };

      if (paymentsRes.status === "fulfilled") transactions.push(...paymentsRes.value);
      else addWarning("payments", paymentsRes.reason);

      if (payoutsRes.status === "fulfilled") transactions.push(...payoutsRes.value);
      else addWarning("payouts", payoutsRes.reason);

      if (refundsRes.status === "fulfilled") transactions.push(...refundsRes.value);
      else addWarning("refunds", refundsRes.reason);

      if (settlementsRes.status === "fulfilled") transactions.push(...settlementsRes.value);
      else addWarning("settlements", settlementsRes.reason);

      if (disputesRes.status === "fulfilled") transactions.push(...disputesRes.value);
      else addWarning("disputes", disputesRes.reason);
    } else if (connector.type === "stripe") {
      const { secret_key } = config;
      if (!secret_key) throw new Error("Missing secret_key");
      const stripe = new StripeConnector(secret_key);
      const [charges, payouts] = await Promise.all([
        stripe.fetchCharges(fromDate, toDate),
        stripe.fetchPayouts(fromDate, toDate),
      ]);
      transactions = [...charges, ...payouts];
    } else {
      throw new Error(`Unsupported connector type: ${connector.type}`);
    }

    result.fetched = transactions.length;

    if (transactions.length > 0) {
      const rows: TransactionInsert[] = transactions.map((tx) => ({
        org_id: orgId,
        connector_id: connector.id,
        external_id: tx.external_id,
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        category: tx.category,
        category_confidence: null,
        counterparty_id: null,
        counterparty_name: tx.counterparty_name,
        description: tx.description,
        source: tx.source,
        status: tx.status,
        transaction_date: tx.transaction_date,
        metadata: tx.metadata as import("@/lib/supabase/types").Json,
      }));

      // Batched dedup — throws if DB query fails (so we surface the error
      // rather than silently treating every row as new and re-inserting)
      const externalIds = rows.map((r) => r.external_id).filter(Boolean) as string[];
      const existingIds =
        externalIds.length > 0
          ? await getExistingExternalIds(supabase, orgId, connector.id, externalIds)
          : new Set<string>();

      const newRows = rows.filter((r) => !r.external_id || !existingIds.has(r.external_id));
      result.skipped = rows.length - newRows.length;

      if (newRows.length > 0) {
        const { error: insertErr, count } = await supabase
          .from("transactions")
          .insert(newRows, { count: "exact" });

        if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
        result.inserted = count ?? newRows.length;
      }
    }

    // Update last_synced_at
    await supabase
      .from("connectors")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", connector.id);

  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    await supabase
      .from("connectors")
      .update({ status: "error" })
      .eq("id", connector.id);
  }

  return result;
}
