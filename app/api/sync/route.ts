import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { RazorpayConnector } from "@/lib/connectors/razorpay";
import { StripeConnector } from "@/lib/connectors/stripe";
import { NormalizedTransaction } from "@/lib/normalizer";
import type { Database } from "@/lib/supabase/types";

type TransactionInsert =
  Database["public"]["Tables"]["transactions"]["Insert"];
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

type SyncResult = {
  connector_id: string;
  type: string;
  synced: number;
  error?: string;
};

// ─── POST /api/sync ───────────────────────────────────────────────────────────
// Body: { org_id: string }

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { org_id } = body;
  if (!org_id) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // ── Fetch all active connectors for this org ──────────────────────────────
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
    return NextResponse.json({ results: [] });
  }

  // Sync window: last 30 days
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── Sync each connector in parallel ──────────────────────────────────────
  const syncPromises = connectors.map(
    (connector: ConnectorRow): Promise<SyncResult> =>
      syncConnector(connector, org_id, fromDate, toDate, supabase)
  );

  const results = await Promise.all(syncPromises);

  return NextResponse.json({ results });
}

// ─── Per-connector sync logic ─────────────────────────────────────────────────

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
    type: connector.type,
    synced: 0,
  };

  try {
    const config = connector.config as Record<string, string>;
    let transactions: NormalizedTransaction[] = [];

    if (connector.type === "razorpay") {
      const { key_id, key_secret } = config;
      if (!key_id || !key_secret) {
        throw new Error("Missing key_id or key_secret");
      }
      const razorpay = new RazorpayConnector(key_id, key_secret);
      const [payments, payouts] = await Promise.all([
        razorpay.fetchPayments(fromDate, toDate),
        razorpay.fetchPayouts(fromDate, toDate),
      ]);
      transactions = [...payments, ...payouts];
    } else if (connector.type === "stripe") {
      const { secret_key } = config;
      if (!secret_key) {
        throw new Error("Missing secret_key");
      }
      const stripe = new StripeConnector(secret_key);
      const [charges, payouts] = await Promise.all([
        stripe.fetchCharges(fromDate, toDate),
        stripe.fetchPayouts(fromDate, toDate),
      ]);
      transactions = [...charges, ...payouts];
    } else {
      throw new Error(`Unsupported connector type: ${connector.type}`);
    }

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

      const { error: upsertErr, count } = await supabase
        .from("transactions")
        .upsert(rows, {
          onConflict: "org_id,connector_id,external_id",
          ignoreDuplicates: false,
          count: "exact",
        });

      if (upsertErr) {
        throw new Error(`Upsert failed: ${upsertErr.message}`);
      }

      result.synced = count ?? rows.length;
    }

    // Update last_synced_at
    await supabase
      .from("connectors")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", connector.id);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);

    // Mark connector as error state
    await supabase
      .from("connectors")
      .update({ status: "error" })
      .eq("id", connector.id);
  }

  return result;
}
