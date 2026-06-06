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

  // fetchPayouts returns [] when no accountNumber is provided (Razorpay X only).
  // All five are wrapped in allSettled so individual 4xx errors become warnings,
  // not hard failures — payments/refunds/settlements succeed regardless.
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

async function fetchConnectorTransactions(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date
) {
  const config = getConfig(connector);

  switch (connector.type) {
    case "razorpay":
      return fetchRazorpay(connector, fromDate, toDate);
    case "stripe":
      return fetchStripe(connector, fromDate, toDate);
    case "cashfree":
      return fetchCashfree(connector, fromDate, toDate);
    case "payu": {
      const { key, salt } = config;
      if (!key || !salt) {
        throw new SyncConfigError("Connector is missing key or salt in config");
      }
      const payu = new PayUConnector(key, salt);
      return fetchSingleEndpoint("transactions", () =>
        payu.fetchTransactions(fromDate, toDate)
      );
    }
    case "paytm": {
      const { merchant_id: merchantId, merchant_key: merchantKey } = config;
      if (!merchantId || !merchantKey) {
        throw new SyncConfigError(
          "Connector is missing merchant_id or merchant_key in config"
        );
      }
      const paytm = new PaytmConnector(merchantId, merchantKey);
      return fetchSingleEndpoint("transactions", () =>
        paytm.fetchTransactions(fromDate, toDate)
      );
    }
    case "easebuzz": {
      const { key, salt } = config;
      if (!key || !salt) {
        throw new SyncConfigError("Connector is missing key or salt in config");
      }
      const easebuzz = new EasebuzzConnector(key, salt);
      return fetchSingleEndpoint("transactions", () =>
        easebuzz.fetchTransactions(fromDate, toDate)
      );
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
  const { transactions, warnings } = await fetchConnectorTransactions(
    connector,
    fromDate,
    toDate
  );

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

    if (newRows.length > 0) {
      // upsert with ignoreDuplicates is a safety net against concurrent syncs:
      // the pre-insert dedup check already filters existing rows, but if two
      // syncs overlap the same date range the second would hit the unique index
      // (org_id, connector_id, external_id) and fail with 23505.
      // ON CONFLICT DO NOTHING silently skips any race-condition duplicates.
      const { error, count } = await supabase
        .from("transactions")
        .upsert(newRows, {
          onConflict:       "org_id,connector_id,external_id",
          ignoreDuplicates: true,
          count:            "exact",
        });

      if (error) throw new Error(`Insert failed: ${error.message}`);
      result.inserted = count ?? newRows.length;
    }

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

      for (const existing of changedMatches) {
        const { error } = await supabase
          .from("transactions")
          .update(refreshFields)
          .eq("id", existing.id)
          .eq("org_id", connector.org_id);

        if (error) {
          throw new Error(`Refresh failed for ${row.external_id}: ${error.message}`);
        }
      }

      result.updated++;
    }
  }

  await supabase
    .from("connectors")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connector.id);

  return result;
}
