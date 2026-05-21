import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { RazorpayConnector } from "@/lib/connectors/razorpay";
import { NormalizedTransaction } from "@/lib/normalizer";
import type { Database } from "@/lib/supabase/types";

type TransactionInsert =
  Database["public"]["Tables"]["transactions"]["Insert"];

// ─── POST /api/connectors/razorpay ────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: {
    connector_id?: string;
    org_id?: string;
    from_date?: string;
    to_date?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { connector_id, org_id, from_date, to_date } = body;

  if (!connector_id || !org_id) {
    return NextResponse.json(
      { error: "connector_id and org_id are required" },
      { status: 400 }
    );
  }

  const supabase = await createServiceClient();

  // ── Fetch connector config ─────────────────────────────────────────────────
  const { data: connector, error: connErr } = await supabase
    .from("connectors")
    .select("*")
    .eq("id", connector_id)
    .eq("org_id", org_id)
    .eq("type", "razorpay")
    .single();

  if (connErr || !connector) {
    return NextResponse.json(
      { error: "Connector not found", details: connErr?.message },
      { status: 404 }
    );
  }

  const config = connector.config as Record<string, string>;
  const keyId = config?.key_id;
  const keySecret = config?.key_secret;

  if (!keyId || !keySecret) {
    return NextResponse.json(
      { error: "Connector is missing key_id or key_secret in config" },
      { status: 422 }
    );
  }

  // ── Determine date range ───────────────────────────────────────────────────
  const toDate = to_date ? new Date(to_date) : new Date();
  const fromDate = from_date
    ? new Date(from_date)
    : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000); // default last 30 days

  // ── Fetch transactions in parallel ────────────────────────────────────────
  const razorpay = new RazorpayConnector(keyId, keySecret);

  const allTransactions: NormalizedTransaction[] = [];
  const errors: string[] = [];

  const [paymentsResult, payoutsResult, refundsResult, settlementsResult] =
    await Promise.allSettled([
      razorpay.fetchPayments(fromDate, toDate),
      razorpay.fetchPayouts(fromDate, toDate),
      razorpay.fetchRefunds(fromDate, toDate),
      razorpay.fetchSettlements(fromDate, toDate),
    ]);

  const capture = (
    label: string,
    result: PromiseSettledResult<NormalizedTransaction[]>
  ) => {
    if (result.status === "fulfilled") {
      allTransactions.push(...result.value);
    } else {
      const msg: string =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      errors.push(`${label}: ${msg.slice(0, 120)}`);
    }
  };

  capture("payments", paymentsResult);
  capture("payouts", payoutsResult);
  capture("refunds", refundsResult);
  capture("settlements", settlementsResult);

  // ── Insert new transactions (skip already-synced ones) ───────────────────
  let synced = 0;
  if (allTransactions.length > 0) {
    const rows: TransactionInsert[] = allTransactions.map((tx) => ({
      org_id,
      connector_id,
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

    // Fetch already-synced external_ids to avoid duplicate inserts
    // (partial unique index on DB can't be used via PostgREST onConflict)
    const externalIds = rows.map((r) => r.external_id).filter(Boolean) as string[];
    let existingIds = new Set<string>();
    if (externalIds.length > 0) {
      const { data: existing } = await supabase
        .from("transactions")
        .select("external_id")
        .eq("org_id", org_id)
        .eq("connector_id", connector_id)
        .in("external_id", externalIds);
      existingIds = new Set((existing ?? []).map((r: { external_id: string | null }) => r.external_id ?? ""));
    }

    const newRows = rows.filter((r) => !r.external_id || !existingIds.has(r.external_id));

    if (newRows.length > 0) {
      const { error: insertErr, count } = await supabase
        .from("transactions")
        .insert(newRows, { count: "exact" });

      if (insertErr) {
        return NextResponse.json(
          { error: "Failed to insert transactions", details: insertErr.message },
          { status: 500 }
        );
      }
      synced = count ?? newRows.length;
    }
  }

  // ── Update connector last_synced_at ───────────────────────────────────────
  await supabase
    .from("connectors")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connector_id);

  return NextResponse.json({
    synced,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    ...(errors.length > 0 ? { warnings: errors } : {}),
  });
}
