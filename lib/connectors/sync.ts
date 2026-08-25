import { CashfreeConnector } from "@/lib/connectors/cashfree";
import { MercuryConnector } from "@/lib/connectors/mercury";
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
import { invalidateOrg } from "@/lib/cache/org-cache";
import { categorizeSource } from "@/lib/finance/transaction-status";
import { BASE_CURRENCY } from "@/lib/utils";
import { enrichRowsWithFx } from "@/lib/fx/rates";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import type { Database } from "@/lib/supabase/types";
import type { createServiceClient } from "@/lib/supabase/server";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];
type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/** Max simultaneous row-refresh UPDATEs during persist. Bounded on purpose: a
 *  re-sync over already-synced data (e.g. backfilling Stripe fees/disputes onto
 *  historical charges) flags thousands of rows as "changed". Firing one UPDATE per
 *  row at once saturates the PostgREST connection pool and pushes the worker past
 *  its 60s function deadline mid-persist — which leaves the job orphaned in
 *  `running` and the backfill stalled. A small pool keeps each persist bounded. */
const UPDATE_CONCURRENCY = 12;

/** Run async thunks with at most `limit` in flight at once (no extra deps). */
async function runPooled(thunks: Array<() => Promise<void>>, limit: number): Promise<void> {
  if (thunks.length === 0) return;
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, thunks.length) }, async () => {
    while (next < thunks.length) {
      await thunks[next++]();
    }
  });
  await Promise.all(runners);
}

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
  // Decrypt secret fields at the point of use — this is the single boundary
  // through which every gateway client (Razorpay/Stripe/Cashfree/PayU/…) reads
  // its credentials, so decrypting here covers them all.
  return decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
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
  // Single source of truth: the Settlement Reconciliation feed (payments + refunds +
  // disputes/chargebacks). The old per-stream order/settlement/refund endpoints don't
  // exist in Cashfree's API.
  return fetchSingleEndpoint("cashfree", () => cashfree.fetchReconEvents(fromDate, toDate));
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

async function fetchMercury(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date
) {
  const { api_token: apiToken } = getConfig(connector);
  if (!apiToken) throw new SyncConfigError("Connector is missing api_token in config");
  const mercury = new MercuryConnector(apiToken);
  // Mercury paginates each account's transactions itself over the window; call
  // directly (not sub-chunked). Read-only bank feed → expenses + inflows.
  return fetchSingleEndpoint("mercury", () => mercury.fetchTransactions(fromDate, toDate));
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
      // Sub-chunking keeps each Stripe pagination to a small (≤7-day) window so
      // every function finishes well under the 60 s budget, and gives the 90-day
      // cron useful parallelism inside its single function. The 504 came from the
      // MANUAL path fanning these windows out × high client concurrency (storm) —
      // fixed there by dropping the costly customer-expand and lowering the client
      // concurrency/chunk size, not by removing sub-chunking.
      return fetchWithSubChunks(connector, fromDate, toDate, fetchStripe);
    case "cashfree":
      // Cashfree's recon report rejects CONCURRENT requests (400
      // internal_processing_error) and already paginates a full window via cursor,
      // so call it directly — one sequential, internally-retried call — NOT through
      // the parallel sub-chunker (which fired several recon calls at once).
      return fetchCashfree(connector, fromDate, toDate);
    case "mercury":
      // Read-only bank feed; paginates internally over the window. Direct call.
      return fetchMercury(connector, fromDate, toDate);
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
  return transactions.map((tx) => {
    // Base-currency (INR) equivalent. The normalizer sets it when it can
    // (e.g. Stripe's settled balance-transaction figure); otherwise rows already
    // in the base currency are 1:1, and foreign rows we can't convert stay null
    // (aggregation falls back to amount, surfacing them rather than mis-summing).
    const amountBase =
      tx.amount_base ?? (tx.currency === BASE_CURRENCY ? tx.amount : null);
    // Identity backstop (source-agnostic): if a normalizer produced no counterparty
    // label but did stash a customer email in metadata (the shared `email` key), use
    // the email as the label. Keeps every charge — from any gateway, present or future —
    // searchable + displayable by customer, so the "unsearchable charge" gap can't recur
    // just because a new connector forgets to set counterparty_name. Deterministic from
    // `tx`, so a re-sync reproduces it (no clobber).
    const metaEmail =
      tx.metadata && typeof tx.metadata === "object"
        ? (tx.metadata as Record<string, unknown>).email
        : null;
    const counterpartyName =
      tx.counterparty_name ?? (typeof metaEmail === "string" && metaEmail ? metaEmail : null);
    return {
    org_id: orgId,
    connector_id: connectorId,
    external_id: tx.external_id,
    type: tx.type,
    amount: tx.amount,
    currency: tx.currency,
    amount_base: amountBase,
    base_currency: tx.base_currency ?? (amountBase !== null ? BASE_CURRENCY : null),
    fx_rate: tx.fx_rate ?? (tx.currency === BASE_CURRENCY ? 1 : null),
    category: tx.category,
    category_confidence: null,
    // Ledger: bank-feed connectors tag 'bank' (drives the revenue firewall +
    // categorization ownership); everything else is 'payments' (PG money).
    ledger: tx.ledger ?? "payments",
    account_type: tx.account_type ?? null,
    card_last4: tx.card_last4 ?? null,
    card_holder: tx.card_holder ?? null,
    counterparty_id: null,
    counterparty_name: counterpartyName,
    description: tx.description,
    source: tx.source,
    status: tx.status,
    transaction_date: tx.transaction_date,
    transaction_at: tx.transaction_at ?? null,
    // Recurring marker: set on INSERT for subscription charges. Deliberately absent
    // from toRefreshFields so the recon/one-time re-sync of the SAME cf_payment_id row
    // never clears it — the recurring signal is durable.
    subscription_id: tx.subscription_id ?? null,
    metadata: tx.metadata as import("@/lib/supabase/types").Json,
    // Full unmodified source payload → the `raw` jsonb column. Stored so any field
    // we don't surface today is a display-only change later, never a re-fetch.
    raw: (tx.raw ?? null) as import("@/lib/supabase/types").Json,
    };
  });
}

function toRefreshFields(row: TransactionInsert): TransactionUpdate {
  return {
    type: row.type,
    amount: row.amount,
    currency: row.currency,
    amount_base: row.amount_base,
    base_currency: row.base_currency,
    fx_rate: row.fx_rate,
    // NOTE: `category` is deliberately NOT refreshed. It's insert-owned for PG
    // rows (stable per external_id) and categorizer-owned for bank rows — a
    // re-sync must never clobber a manual/AI/rule categorization. Same durable
    // posture as subscription_id/ledger.
    counterparty_name: row.counterparty_name,
    description: row.description,
    source: row.source,
    status: row.status,
    transaction_date: row.transaction_date,
    transaction_at: row.transaction_at ?? null,
    metadata: row.metadata,
    // Keep the stored raw payload current (and backfill it onto rows that predate
    // raw capture — see hasTransactionChanged's has_raw gap check).
    raw: row.raw ?? null,
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
    // null→value transition backfills amount_base on re-sync of foreign rows
    (existing.amount_base == null) !== (next.amount_base == null) ||
    (existing.amount_base != null && next.amount_base != null &&
      Number(existing.amount_base) !== Number(next.amount_base)) ||
    // category intentionally excluded — it's durable (see toRefreshFields).
    existing.counterparty_name !== next.counterparty_name ||
    existing.description !== next.description ||
    existing.source !== next.source ||
    existing.status !== next.status ||
    existing.transaction_date !== next.transaction_date ||
    stableJson(existing.metadata) !== stableJson(next.metadata) ||
    // Row predates raw-payload capture but this sync carries one → refresh to
    // backfill `raw`. Makes every re-sync self-healing (fills raw gaps) and drives
    // the one-time historical backfill without a bespoke script.
    (!existing.has_raw && next.raw != null)
  );
}

/**
 * Persist a batch of normalized transactions: FX-enrich → dedup by external_id →
 * insert new + refresh changed. Idempotent (safe to re-run a batch — duplicates
 * are skipped). Shared by the one-shot sync and the resumable cursor engine.
 */
export async function persistTransactions(
  supabase: ServiceClient,
  orgId: string,
  connectorId: string,
  transactions: NormalizedTransaction[]
): Promise<{ inserted: number; updated: number; skipped: number }> {
  const out = { inserted: 0, updated: 0, skipped: 0 };
  if (transactions.length === 0) return out;

  const rows = toInsertRows(orgId, connectorId, transactions);
  // Canary: a payment-ledger credit with NO customer identity at all (no label AND no
  // email in metadata) is unsearchable by customer — the gap this file's backstop exists
  // to prevent. If a normalizer still produces one, surface it in logs so a new/changed
  // gateway is caught early instead of going silently unsearchable.
  const identityGaps = rows.filter(
    (r) =>
      r.type === "credit" &&
      (r.ledger ?? "payments") === "payments" &&
      !r.counterparty_name &&
      !((r.metadata as Record<string, unknown> | null)?.email)
  ).length;
  if (identityGaps > 0) {
    console.warn(`[sync] ${identityGaps}/${rows.length} ${rows[0]?.source ?? "?"} payment credits have no customer identity (no name, no metadata.email) — not searchable by customer`);
  }
  // Convert foreign-currency rows to the base currency (INR) — the settling
  // gateway can't always provide it (a USD Stripe account never sees INR), so we
  // convert via ECB rates at each transaction's date.
  await enrichRowsWithFx(rows);

  const externalIds = rows.map((r) => r.external_id).filter(Boolean) as string[];
  const existingByExternalId = externalIds.length
    ? await getExistingTransactionsByExternalId(supabase, orgId, externalIds)
    : new Map<string, ExistingTransactionByExternalId[]>();

  const newRows = rows.filter((r) => !r.external_id || !existingByExternalId.has(r.external_id));
  const existingRows = rows.filter((r) => r.external_id && existingByExternalId.has(r.external_id));

  if (newRows.length > 0) {
    const { error, count } = await supabase
      .from("transactions")
      .insert(newRows, { count: "exact" });
    if (error) {
      // 23505 = unique_violation: a concurrent sync inserted some rows first. The
      // partial unique index can't be referenced by upsert, so plain insert +
      // catching 23505 is correct — treat as skipped (data already present).
      if (error.code === "23505") {
        out.skipped += newRows.length;
      } else {
        throw new Error(`Insert failed: ${error.message}`);
      }
    } else {
      out.inserted = count ?? newRows.length;
    }
  }

  // Refresh changed existing rows through a BOUNDED pool (not an unbounded
  // Promise.all — see UPDATE_CONCURRENCY). Build the work list first, then drain it
  // at a safe concurrency so a large re-sync can't storm the connection pool.
  const updateThunks: Array<() => Promise<void>> = [];
  for (const row of existingRows) {
    if (!row.external_id) continue;
    const existingMatches = existingByExternalId.get(row.external_id) ?? [];
    const refreshFields = toRefreshFields(row);
    const changedMatches = existingMatches.filter((e) => hasTransactionChanged(e, refreshFields));
    if (changedMatches.length === 0) {
      out.skipped++;
      continue;
    }
    out.updated++;
    for (const existing of changedMatches) {
      updateThunks.push(async () => {
        const { error } = await supabase
          .from("transactions")
          .update(refreshFields)
          .eq("id", existing.id)
          .eq("org_id", orgId);
        if (error) throw new Error(`Refresh failed for ${row.external_id}: ${error.message}`);
      });
    }
  }
  await runPooled(updateThunks, UPDATE_CONCURRENCY);

  // Refunds carry no customer of their own — a refund references a payment, not a
  // person. Inherit the customer (name/email/phone) from the linked payment row so
  // refunds show who they belong to. Runs for webhooks AND syncs (real-time).
  // Non-fatal: a failure here must never break the core persist (e.g. a webhook 200).
  try {
    await enrichRefundCustomers(
      supabase,
      orgId,
      rows.filter((r) => categorizeSource(r.source) === "refund")
    );
  } catch (err) {
    console.error("[persist] refund customer enrichment failed (non-fatal):", err);
  }

  // Bust cached org aggregates when data actually changed, so the dashboard
  // reflects a sync/webhook immediately even with a long cache TTL. revalidateTag
  // is request-scoped and persistTransactions always runs inside a route handler;
  // guard anyway so a non-request caller can never break the persist.
  if (out.inserted > 0 || out.updated > 0) {
    try { invalidateOrg(orgId); } catch { /* not in a request scope — ignore */ }
  }

  return out;
}

/**
 * Copy the customer (name/email/phone) onto refund rows from the payment they
 * reference. Razorpay refunds link via metadata.payment_id (pay_xxx); Cashfree
 * via metadata.cf_payment_id (→ cf_pay_<id>). Only fills gaps — never overwrites a
 * value the refund already has. Idempotent.
 */
async function enrichRefundCustomers(
  supabase: ServiceClient,
  orgId: string,
  refundRows: TransactionInsert[]
): Promise<void> {
  const linkByRefund = new Map<string, string>(); // refund external_id → payment external_id
  for (const r of refundRows) {
    if (!r.external_id) continue;
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    let payExt: string | null = null;
    if (typeof m.payment_id === "string" && m.payment_id) payExt = m.payment_id;
    else if (m.cf_payment_id != null) payExt = `cf_pay_${m.cf_payment_id}`;
    if (payExt) linkByRefund.set(r.external_id, payExt);
  }
  if (linkByRefund.size === 0) return;

  const { data: pays } = await supabase
    .from("transactions")
    .select("external_id, counterparty_name, metadata")
    .eq("org_id", orgId)
    .in("external_id", [...new Set(linkByRefund.values())]);
  const payByExt = new Map((pays ?? []).map((p) => [p.external_id as string, p]));

  const { data: refs } = await supabase
    .from("transactions")
    .select("id, external_id, counterparty_name, metadata")
    .eq("org_id", orgId)
    .in("external_id", [...linkByRefund.keys()]);

  const thunks: Array<() => Promise<void>> = [];
  for (const ref of refs ?? []) {
    const pay = payByExt.get(linkByRefund.get(ref.external_id as string) ?? "");
    if (!pay) continue;
    const rm = (ref.metadata ?? {}) as Record<string, unknown>;
    const pm = (pay.metadata ?? {}) as Record<string, unknown>;
    const curEmail = (rm.email as string | null | undefined) ?? null;
    const curPhone = (rm.phone as string | null | undefined) ?? null;
    const name = ref.counterparty_name ?? (pay.counterparty_name as string | null) ?? null;
    const email = curEmail ?? (pm.email as string | null | undefined) ?? null;
    const phone = curPhone ?? (pm.phone as string | null | undefined) ?? null;
    if (name === (ref.counterparty_name ?? null) && email === curEmail && phone === curPhone) continue; // nothing to fill
    const metadata = { ...rm, email, phone };
    thunks.push(async () => {
      await supabase
        .from("transactions")
        .update({ counterparty_name: name, metadata: metadata as import("@/lib/supabase/types").Json })
        .eq("id", ref.id as string)
        .eq("org_id", orgId);
    });
  }
  await runPooled(thunks, UPDATE_CONCURRENCY);
}

/**
 * Mirror a source's full current contents into transactions (used by link
 * connectors — Google Sheets / online Excel). The spreadsheet IS the source of
 * truth, and its rows have no stable external_id, so each sync REPLACES this
 * connector's rows: delete then insert the freshly-parsed set. This reflects
 * edits and deletions and can never create duplicates.
 *
 * Safety: if `transactions` is empty (e.g. a transient bad fetch returned no
 * rows) we do NOT delete — never wipe existing data on a failed read.
 */
export async function replaceConnectorTransactions(
  supabase: ServiceClient,
  orgId: string,
  connectorId: string,
  transactions: NormalizedTransaction[]
): Promise<{ inserted: number }> {
  if (transactions.length === 0) return { inserted: 0 };

  const rows = toInsertRows(orgId, connectorId, transactions);
  await enrichRowsWithFx(rows); // INR equivalent for any foreign-currency rows

  const { error: delErr } = await supabase
    .from("transactions")
    .delete()
    .eq("org_id", orgId)
    .eq("connector_id", connectorId);
  if (delErr) throw new Error(`Replace delete failed: ${delErr.message}`);

  const { error, count } = await supabase
    .from("transactions")
    .insert(rows, { count: "exact" });
  if (error) throw new Error(`Replace insert failed: ${error.message}`);

  await supabase
    .from("connectors")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connectorId);

  return { inserted: count ?? rows.length };
}

/**
 * MERGE a connector's transactions from a re-readable source (link/sheet), instead
 * of the destructive replace. New rows (by external_id) are inserted; existing rows
 * have only their SOURCE fields refreshed — user-owned fields (pnl_treatment,
 * category, category_confidence) are PRESERVED, so categorizing a bank row in
 * Review survives the next sync. Rows absent from the source are NOT deleted.
 * Requires stable external_ids; legacy rows with a null external_id for this
 * connector (old mirror artifacts) are cleared once so they don't duplicate.
 */
export async function mergeConnectorTransactions(
  supabase: ServiceClient,
  orgId: string,
  connectorId: string,
  transactions: NormalizedTransaction[]
): Promise<{ inserted: number; updated: number }> {
  if (transactions.length === 0) return { inserted: 0, updated: 0 };

  const rows = toInsertRows(orgId, connectorId, transactions);
  await enrichRowsWithFx(rows);

  // One-time cleanup: drop legacy null-external_id rows for this connector (they
  // can't be merged and would otherwise co-exist with the new keyed rows).
  await supabase.from("transactions").delete().eq("org_id", orgId).eq("connector_id", connectorId).is("external_id", null);

  const externalIds = rows.map((r) => r.external_id).filter(Boolean) as string[];
  const existing = externalIds.length
    ? await getExistingTransactionsByExternalId(supabase, orgId, externalIds)
    : new Map();

  const newRows = rows.filter((r) => !r.external_id || !existing.has(r.external_id));
  const updRows = rows.filter((r) => r.external_id && existing.has(r.external_id));

  let inserted = 0;
  let updated = 0;

  if (newRows.length > 0) {
    const { error, count } = await supabase.from("transactions").insert(newRows, { count: "exact" });
    if (error) throw new Error(`Merge insert failed: ${error.message}`);
    inserted = count ?? newRows.length;
  }

  // Refresh source fields only — never category/pnl_treatment (user-owned). Also
  // skip any field the user manually edited in-app (metadata.manual_fields), so
  // inline edits survive the sync.
  for (const r of updRows) {
    const dupes = existing.get(r.external_id as string) ?? [];
    for (const e of dupes) {
      const eMeta = (e as { metadata?: Record<string, unknown> | null }).metadata ?? {};
      const manual = Array.isArray(eMeta.manual_fields) ? (eMeta.manual_fields as string[]) : [];
      const refresh: Record<string, unknown> = {
        type: r.type, amount: r.amount, currency: r.currency,
        counterparty_name: r.counterparty_name, description: r.description,
        transaction_date: r.transaction_date, metadata: r.metadata, raw: r.raw,
        ledger: r.ledger, account_type: r.account_type,
        amount_base: r.amount_base, base_currency: r.base_currency, fx_rate: r.fx_rate,
      };
      if (manual.length > 0) {
        for (const f of manual) delete refresh[f];
        if (manual.includes("amount")) { delete refresh.amount_base; delete refresh.base_currency; delete refresh.fx_rate; }
        // preserve the manual-fields marker so future syncs keep skipping them
        refresh.metadata = { ...((r.metadata ?? {}) as Record<string, unknown>), manual_fields: manual };
      }
      const { error } = await supabase.from("transactions").update(refresh).eq("id", e.id).eq("org_id", orgId);
      if (error) throw new Error(`Merge update failed for ${r.external_id}: ${error.message}`);
      updated++;
    }
  }

  await supabase.from("connectors").update({ last_synced_at: new Date().toISOString() }).eq("id", connectorId);
  return { inserted, updated };
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

  const { transactions, warnings } = await fetchConnectorTransactions(connector, fromDate, toDate);
  console.log(`[sync] fetched=${transactions.length} warnings=${warnings.length}`, warnings.length ? warnings : "");

  const persisted = await persistTransactions(supabase, connector.org_id, connector.id, transactions);

  await supabase
    .from("connectors")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connector.id);

  return { fetched: transactions.length, warnings, ...persisted };
}
