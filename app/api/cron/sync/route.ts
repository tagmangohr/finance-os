import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { RazorpayConnector } from "@/lib/connectors/razorpay";
import { StripeConnector } from "@/lib/connectors/stripe";
import { NormalizedTransaction } from "@/lib/normalizer";
import { getExistingExternalIds } from "@/lib/db/dedup";
import type { Database } from "@/lib/supabase/types";

type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

/**
 * GET /api/cron/sync
 *
 * Called by Vercel Cron every hour (configured in vercel.json).
 * Syncs the last 2 hours of data across all orgs with active connectors.
 * Protected by CRON_SECRET to prevent unauthorised calls.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Verify Vercel Cron secret (set automatically by Vercel, or CRON_SECRET env var)
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  // Fetch all active connectors across ALL orgs
  const { data: connectors, error: connErr } = await supabase
    .from("connectors")
    .select("*")
    .eq("status", "active")
    .in("type", ["razorpay", "stripe"]);

  if (connErr) {
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }

  if (!connectors || connectors.length === 0) {
    return NextResponse.json({ message: "No active connectors", synced: 0 });
  }

  // Sync the last 2 hours (small overlap ensures no gaps between hourly runs)
  const toDate   = new Date();
  const fromDate = new Date(toDate.getTime() - 2 * 60 * 60 * 1000);

  // Run all connectors in parallel
  const results = await Promise.allSettled(
    connectors.map((c: ConnectorRow) => syncOne(c, fromDate, toDate, supabase))
  );

  const summary = results.map((r, i) => ({
    connector: connectors[i].name,
    type: connectors[i].type,
    status: r.status,
    inserted: r.status === "fulfilled" ? r.value : 0,
    error: r.status === "rejected" ? String(r.reason) : undefined,
  }));

  const totalInserted = summary.reduce((s, r) => s + (r.inserted as number), 0);

  console.log(`[cron/sync] ${new Date().toISOString()} — ${connectors.length} connectors, ${totalInserted} new txns`);

  return NextResponse.json({ message: "OK", synced: totalInserted, detail: summary });
}

// ── Per-connector sync (returns inserted count) ───────────────────────────────

async function syncOne(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<number> {
  const config = connector.config as Record<string, string>;
  const transactions: NormalizedTransaction[] = [];

  if (connector.type === "razorpay") {
    const { key_id, key_secret } = config;
    if (!key_id || !key_secret) return 0;
    const rzp = new RazorpayConnector(key_id, key_secret);

    const settled = await Promise.allSettled([
      rzp.fetchPayments(fromDate, toDate),
      rzp.fetchRefunds(fromDate, toDate),
      rzp.fetchSettlements(fromDate, toDate),
      rzp.fetchDisputes(fromDate, toDate),
      rzp.fetchPayouts(fromDate, toDate),
    ]);
    for (const r of settled) {
      if (r.status === "fulfilled") transactions.push(...r.value);
    }
  } else if (connector.type === "stripe") {
    const { secret_key } = config;
    if (!secret_key) return 0;
    const stripe = new StripeConnector(secret_key);
    const settled = await Promise.allSettled([
      stripe.fetchCharges(fromDate, toDate),
      stripe.fetchPayouts(fromDate, toDate),
    ]);
    for (const r of settled) {
      if (r.status === "fulfilled") transactions.push(...r.value);
    }
  }

  if (transactions.length === 0) return 0;

  const rows: TransactionInsert[] = transactions.map((tx) => ({
    org_id: connector.org_id,
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

  const externalIds = rows.map((r) => r.external_id).filter(Boolean) as string[];
  const existingIds = externalIds.length > 0
    ? await getExistingExternalIds(supabase, connector.org_id, externalIds)
    : new Set<string>();

  const newRows = rows.filter((r) => !r.external_id || !existingIds.has(r.external_id));
  if (newRows.length === 0) return 0;

  const { error, count } = await supabase
    .from("transactions")
    .insert(newRows, { count: "exact" });

  if (error) throw new Error(error.message);

  await supabase
    .from("connectors")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connector.id);

  return count ?? newRows.length;
}
