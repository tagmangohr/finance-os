import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { PaytmConnector } from "@/lib/connectors/paytm";
import { NormalizedTransaction } from "@/lib/normalizer";
import { getExistingExternalIds } from "@/lib/db/dedup";
import type { Database } from "@/lib/supabase/types";

type TransactionInsert =
  Database["public"]["Tables"]["transactions"]["Insert"];

// ─── POST /api/connectors/paytm ───────────────────────────────────────────────

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
    .eq("type", "paytm")
    .single();

  if (connErr || !connector) {
    return NextResponse.json(
      { error: "Connector not found", details: connErr?.message },
      { status: 404 }
    );
  }

  const config = connector.config as Record<string, string>;
  const merchantId = config?.merchant_id;
  const merchantKey = config?.merchant_key;

  if (!merchantId || !merchantKey) {
    return NextResponse.json(
      { error: "Connector is missing merchant_id or merchant_key in config" },
      { status: 422 }
    );
  }

  // ── Determine date range ───────────────────────────────────────────────────
  const toDate = to_date ? new Date(to_date) : new Date();
  const fromDate = from_date
    ? new Date(from_date)
    : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── Fetch transactions ────────────────────────────────────────────────────
  const paytm = new PaytmConnector(merchantId, merchantKey);

  const allTransactions: NormalizedTransaction[] = [];
  const errors: string[] = [];

  try {
    const txns = await paytm.fetchTransactions(fromDate, toDate);
    allTransactions.push(...txns);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`transactions: ${msg.slice(0, 120)}`);
  }

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

    const externalIds = rows.map((r) => r.external_id).filter(Boolean) as string[];
    const existingIds =
      externalIds.length > 0
        ? await getExistingExternalIds(supabase, org_id, externalIds)
        : new Set<string>();

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
