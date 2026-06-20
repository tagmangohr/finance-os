import { CashfreeConnector } from "@/lib/connectors/cashfree";
import { EasebuzzConnector } from "@/lib/connectors/easebuzz";
import { PaytmConnector } from "@/lib/connectors/paytm";
import { PayUConnector } from "@/lib/connectors/payu";
import { RazorpayConnector } from "@/lib/connectors/razorpay";
import { StripeConnector } from "@/lib/connectors/stripe";
import {
  getExistingTransactionsByExternalId,
  type ExistingTransactionByExternalId,
} from "@/lib/db/dedup";
import type { NormalizedTransaction } from "@/lib/normalizer";
import type { Database } from "@/lib/supabase/types";
import type { createServiceClient } from "@/lib/supabase/server";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];
type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type ConnectorSyncResult = {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
};

export class SyncConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncConfigError";
  }
}

function getConfig(connector: ConnectorRow): Record<string, string> {
  return connector.config as Record<string, string>;
}

function warning(label: string, reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return `${label}: ${message.slice(0, 120)}`;
}

async function fetchRazorpay(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date
) {
  const { key_id: keyId, key_secret: keySecret, account_number: accountNumber } = getConfig(connector);
  if (!keyId || !keySecret) {
    throw new SyncConfigError("Connector is missing key_id or key_secret in config");
  }

  const razorpay = new RazorpayConnector(keyId, keySecret);

  // fetchPayouts is Razorpay X-only and OPTIONAL: it returns [] when no account
  // number is set AND swallows its own 4xx (invalid/non-X account) so a bad
  // optional field never adds a warning or distorts counts. The remaining four
  // are wrapped in allSettled so a genuine outage on one becomes a single
  // warning, not a hard failure — payments/refunds/settlements succeed regardless.
  const settled = await Promise.allSettled([
    razorpay.fetchPayments(fromDate, toDate),
    razorpay.fetchPayouts(fromDate, toDate, accountNumber),
    razorpay.fetchRefunds(fromDate, toDate),
    razorpay.fetchSettlements(fromDate, toDate),
    razorpay.fetchDisputes(fromDate, toDate),
  ]);

  const labels = ["payments", "payouts", "refunds", "settlements", "disputes"];
  return collectSettled(labels, settled);
}

async function fetchStripe(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date
) {
  const { secret_key: secretKey } = getConfig(connector);
  if (!secretKey) {
    throw new SyncConfigError("Connector is missing secret_key in config");
  }

  const stripe = new StripeConnector(secretKey);
  const settled = await Promise.allSettled([
    stripe.fetchCharges(fromDate, toDate),
    stripe.fetchPayouts(fromDate, toDate),
  ]);

  return collectSettled(["charges", "payouts"], settled);
}

async function fetchCashfree(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date
) {
  const { client_id: clientId, client_secret: clientSecret } = getConfig(connector);
  if (!clientId || !clientSecret) {
    throw new SyncConfigError("Connector is missing client_id or client_secret in config");
  }

  const cashfree = new CashfreeConnector(clientId, clientSecret);
  const settled = await Promise.allSettled([
    cashfree.fetchOrders(fromDate, toDate),
    cashfree.fetchSettlements(fromDate, toDate),
    cashfree.fetchRefunds(fromDate, toDate),
  ]);

  return collectSettled(["orders", "settlements", "refunds"], settled);
}

async function fetchSingleEndpoint(
  label: string,
  fetcher: () => Promise<NormalizedTransaction[]>
) {
  try {
    return { transactions: await fetcher(), warnings: [] };
  } catch (err) {
    return { transactions: [], warnings: [warning(label, err)] };
  }
}

// ─── Server-side sub-chunking ─────────────────────────────────────────────────
// The browser sends 30-day windows to minimise round-trips.  Inside each
// Vercel function we further split into 7-day sub-windows so that each
// payment-gateway API call fetches at most ~100 records (1 page).  This
// eliminates multi-page pagination loops that were causing 504 timeouts.
// Auth happens only once per Vercel call; Razorpay calls are the cheap bit.
const SERVER_SUB_CHUNK_DAYS = 7;

function splitSubRange(from: Date, to: Date): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(from);
  const chunkMs = SERVER_SUB_CHUNK_DAYS * 24 * 60 * 60 * 1000;
  while (cursor < to) {
    const end = new Date(Math.min(cursor.getTime() + chunkMs, to.getTime()));
    chunks.push({ from: new Date(cursor), to: end });
    cursor = new Date(end.getTime() + 1);
  }
  return chunks;
}

type GatewayFetcher = (
  connector: ConnectorRow,
  from: Date,
  to: Date
) => Promise<{ transactions: NormalizedTransaction[]; warnings: string[] }>;

async function fetchWithSubChunks(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date,
  fetcher: GatewayFetcher
): Promise<{ transactions: NormalizedTransaction[]; warnings: string[] }> {
  const subChunks = splitSubRange(fromDate, toDate);
  // Run all sub-windows in parallel — each covers a non-overlapping date range
  // so there are no data dependencies.  This reduces the critical path from
  // N × longest_call to just max(longest_call), keeping every Vercel function
  // well under its timeout regardless of how many sub-windows are needed.
  const results = await Promise.all(
    subChunks.map((chunk) => fetcher(connector, chunk.from, chunk.to))
  );
  return {
    transactions: results.flatMap((r) => r.transactions),
    warnings:     results.flatMap((r) => r.warnings),
  };
}

async function fetchConnectorTransactions(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date
) {
  const config = getConfig(connector);

  switch (connector.type) {
    // API-based connectors: use server-side sub-chunking so each payment-gateway
    // call stays under 1 page and the Vercel function never approaches its timeout.
    case "razorpay":
      return fetchWithSubChunks(connector, fromDate, toDate, fetchRazorpay);
    case "stripe":
      return fetchWithSubChunks(connector, fromDate, toDate, fetchStripe);
    case "cashfree":
      return fetchWithSubChunks(connector, fromDate, toDate, fetchCashfree);
    case "payu": {
      const { key, salt } = config;
      if (!key || !salt) {
        throw new SyncConfigError("Connector is missing key or salt in config");
      }
      return fetchWithSubChunks(connector, fromDate, toDate, (conn, from, to) => {
        const cfg = getConfig(conn);
        const payu = new PayUConnector(cfg.key, cfg.salt);
        return fetchSingleEndpoint("transactions", () =>
          payu.fetchTransactions(from, to)
        );
      });
    }
    case "paytm": {
      const { merchant_id: merchantId, merchant_key: merchantKey } = config;
      if (!merchantId || !merchantKey) {
        throw new SyncConfigError(
          "Connector is missing merchant_id or merchant_key in config"
        );
      }
      return fetchWithSubChunks(connector, fromDate, toDate, (conn, from, to) => {
        const cfg = getConfig(conn);
        const paytm = new PaytmConnector(cfg.merchant_id, cfg.merchant_key);
        return fetchSingleEndpoint("transactions", () =>
          paytm.fetchTransactions(from, to)
        );
      });
    }
    case "easebuzz": {
      const { key, salt } = config;
      if (!key || !salt) {
        throw new SyncConfigError("Connector is missing key or salt in config");
      }
      return fetchWithSubChunks(connector, fromDate, toDate, (conn, from, to) => {
        const cfg = getConfig(conn);
        const easebuzz = new EasebuzzConnector(cfg.key, cfg.salt);
        return fetchSingleEndpoint("transactions", () =>
          easebuzz.fetchTransactions(from, to)
        );
      });
    }
    default:
      throw new SyncConfigError(`Unsupported connector type: ${connector.type}`);
  }
}

function collectSettled(
  labels: string[],
  settled: PromiseSettledResult<NormalizedTransaction[]>[]
) {
  const transactions: NormalizedTransaction[] = [];
  const warnings: string[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      transactions.push(...result.value);
    } else {
      warnings.push(warning(labels[index] ?? "endpoint", result.reason));
    }
  });

  return { transactions, warnings };
}

function toInsertRows(
  orgId: string,
  connectorId: string,
  transactions: NormalizedTransaction[]
): TransactionInsert[] {
  return transactions.map((tx) => ({
    org_id: orgId,
    connector_id: connectorId,
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
}

function toRefreshFields(row: TransactionInsert): TransactionUpdate {
  return {
    type: row.type,
    amount: row.amount,
    currency: row.currency,
    category: row.category,
    counterparty_name: row.counterparty_name,
    description: row.description,
    source: row.source,
    status: row.status,
    transaction_date: row.transaction_date,
    metadata: row.metadata,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function hasTransactionChanged(
  existing: ExistingTransactionByExternalId,
  next: TransactionUpdate
): boolean {
  return (
    existing.type !== next.type ||
    Number(existing.amount) !== Number(next.amount) ||
    existing.currency !== next.currency ||
    existing.category !== next.category ||
    existing.counterparty_name !== next.counterparty_name ||
    existing.description !== next.description ||
    existing.source !== next.source ||
    existing.status !== next.status ||
    existing.transaction_date !== next.transaction_date ||
    stableJson(existing.metadata) !== stableJson(next.metadata)
  );
}

export async function syncConnectorTransactions({
  supabase,
  connector,
  fromDate,
  toDate,
}: {
  supabase: ServiceClient;
  connector: ConnectorRow;
  fromDate: Date;
  toDate: Date;
}): Promise<ConnectorSyncResult> {
  console.log(`[sync] start connector=${connector.id} type=${connector.type} from=${fromDate.toISOString()} to=${toDate.toISOString()}`);

  const { transactions, warnings } = await fetchConnectorTransactions(
    connector,
    fromDate,
    toDate
  );

  console.log(`[sync] fetched=${transactions.length} warnings=${warnings.length}`, warnings.length ? warnings : "");

  const result: ConnectorSyncResult = {
    fetched: transactions.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    warnings,
  };

  if (transactions.length > 0) {
    const rows = toInsertRows(connector.org_id, connector.id, transactions);
    const externalIds = rows
      .map((row) => row.external_id)
      .filter(Boolean) as string[];
    const existingByExternalId = externalIds.length
      ? await getExistingTransactionsByExternalId(
          supabase,
          connector.org_id,
          externalIds
        )
      : new Map<string, ExistingTransactionByExternalId[]>();

    const newRows = rows.filter(
      (row) => !row.external_id || !existingByExternalId.has(row.external_id)
    );
    const existingRows = rows.filter(
      (row) => row.external_id && existingByExternalId.has(row.external_id)
    );

    console.log(`[sync] new=${newRows.length} existing=${existingRows.length} skipped-dedup=${rows.length - newRows.length - existingRows.length}`);

    if (newRows.length > 0) {
      const { error, count } = await supabase
        .from("transactions")
        .insert(newRows, { count: "exact" });

      if (error) {
        // 23505 = unique_violation: a concurrent sync beat us to it for some rows.
        // The unique index on (org_id, connector_id, external_id) is PARTIAL
        // (WHERE external_id IS NOT NULL), so Supabase's upsert/onConflict cannot
        // reference it — plain insert + catching 23505 is the correct pattern.
        // Treat as skipped; the data is already in the DB from the other sync.
        if (error.code === "23505") {
          console.warn(`[sync] 23505 duplicate on insert — concurrent sync, treating as skipped`);
          result.skipped += newRows.length;
        } else {
          console.error(`[sync] INSERT ERROR code=${error.code} message=${error.message} details=${error.details}`);
          throw new Error(`Insert failed: ${error.message}`);
        }
      } else {
        result.inserted = count ?? newRows.length;
        console.log(`[sync] inserted=${result.inserted}`);
      }
    }

    // Build all update tasks first, then run them in parallel.
    // Sequential updates (the old approach) cost N × ~100 ms per changed row;
    // parallel runs them all in ~100 ms regardless of N.
    const updateTasks: Array<Promise<void>> = [];

    for (const row of existingRows) {
      if (!row.external_id) continue;

      const existingMatches = existingByExternalId.get(row.external_id) ?? [];
      const refreshFields = toRefreshFields(row);
      const changedMatches = existingMatches.filter((existing) =>
        hasTransactionChanged(existing, refreshFields)
      );

      if (changedMatches.length === 0) {
        result.skipped++;
        continue;
      }

      result.updated++;
      for (const existing of changedMatches) {
        const task = async (): Promise<void> => {
          const { error } = await supabase
            .from("transactions")
            .update(refreshFields)
            .eq("id", existing.id)
            .eq("org_id", connector.org_id);
          if (error) throw new Error(`Refresh failed for ${row.external_id}: ${error.message}`);
        };
        updateTasks.push(task());
      }
    }

    if (updateTasks.length > 0) {
      await Promise.all(updateTasks);
    }
  }

  await supabase
    .from("connectors")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connector.id);

  return result;
}
