import type { createServiceClient } from "@/lib/supabase/server";
import type { ConnectorSyncResult } from "@/lib/connectors/sync";
import { syncConnectorTransactions, persistTransactions, SyncConfigError } from "@/lib/connectors/sync";
import { StripeConnector } from "@/lib/connectors/stripe";
import { RazorpayConnector } from "@/lib/connectors/razorpay";
import { CashfreeConnector } from "@/lib/connectors/cashfree";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { syncGatewaySubscriptions } from "@/lib/subscriptions/sync";
import { syncGatewayInvoices, tagSubscriptionCharges } from "@/lib/subscriptions/invoices";
import type { NormalizedTransaction } from "@/lib/normalizer";
import { advanceCheckpoint, OVERLAP_DAYS, INITIAL_BACKFILL_DAYS } from "@/lib/connectors/checkpoint";
import type { Database, SyncJobRow } from "@/lib/supabase/types";

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Legacy date-window size for connectors NOT on the resumable engine (low
 *  volume — they finish a whole window in one pass). */
export const JOB_WINDOW_DAYS = 14;
/** Resumable connectors are split into windows this size so several run in
 *  parallel; each window is then paginated in bounded cursor chunks, so the
 *  window size only affects parallelism, never whether a call fits the budget. */
export const RESUMABLE_WINDOW_DAYS = 30;
/** Jobs claimed per worker batch. */
export const CLAIM_BATCH = 3;
/** Per-chunk fetch budget — a resumable job paginates for at most this long, then
 *  saves its cursor and continues next pass. Well under the 60s function limit. */
export const CHUNK_FETCH_MS = 18_000;
/** Stop CLAIMING new work once this much of the invocation is used, so an
 *  in-flight chunk still finishes within the 60s function limit. */
export const WORKER_BUDGET_MS = 25_000;
/** Consecutive reclaims-without-progress before a job is failed (progress resets
 *  the counter, so this only catches genuinely stuck jobs, never long backfills). */
export const MAX_RECLAIMS = 8;
/** A 'running' job is held by a live worker for at most one function lifetime
 *  (maxDuration 60s). Anything locked longer than this is orphaned — its worker
 *  died/timed-out mid-chunk. Safely above 60s so we never steal from a live worker,
 *  but far below the SQL claim's 5-min window so backfills recover fast, not stall. */
export const RECLAIM_AFTER_MS = 90_000;

/** Connectors whose streams are paginated resumably (cursor-checkpointed). Each
 *  stream is fetched in time-boxed, row-capped chunks so any volume — months or
 *  years — syncs safely without ever exceeding the function budget. */
const CURSOR_STREAMS: Record<string, string[]> = {
  stripe: ["charges", "payouts", "disputes"],
  razorpay: ["payments", "refunds", "settlements", "disputes"],
};

export function isResumable(type: string): boolean {
  return type in CURSOR_STREAMS;
}

/**
 * Enqueue a date-range backfill. Resumable connectors get one job per
 * RESUMABLE_WINDOW_DAYS window (parallelism) — each job then paginates its window
 * in bounded chunks. Legacy connectors get one job per JOB_WINDOW_DAYS window.
 *
 * EXCEPTION — Cashfree: enqueued as a SINGLE whole-range job. Its recon report
 * returns short/incomplete results when paginated concurrently, so it must run as
 * one sequential cursor chain (the connector walks ≤28-day sub-windows internally).
 */
export async function enqueueBackfill(
  supabase: SupabaseLike,
  connector: Pick<ConnectorRow, "id" | "org_id" | "type">,
  fromDate: Date,
  toDate: Date
): Promise<number> {
  // One job covering the entire range (no parallel windows) for concurrency-
  // sensitive connectors.
  const stepMs =
    connector.type === "cashfree"
      ? toDate.getTime() - fromDate.getTime() + 1
      : (isResumable(connector.type) ? RESUMABLE_WINDOW_DAYS : JOB_WINDOW_DAYS) * DAY_MS;
  const rows: Database["public"]["Tables"]["sync_jobs"]["Insert"][] = [];
  let cursor = fromDate.getTime();
  const end = toDate.getTime();

  while (cursor < end) {
    const windowEnd = Math.min(cursor + stepMs, end);
    rows.push({
      org_id: connector.org_id,
      connector_id: connector.id,
      type: connector.type,
      window_from: new Date(cursor).toISOString(),
      window_to: new Date(windowEnd).toISOString(),
    });
    cursor = windowEnd;
  }

  if (rows.length === 0) return 0;
  const { error } = await supabase.from("sync_jobs").insert(rows);
  if (error) throw new Error(`Failed to enqueue backfill: ${error.message}`);
  return rows.length;
}

/**
 * Enqueue an incremental "catch up to now" job for a resumable connector. Paginates
 * [synced_through - overlap, now] (bounded chunks) and advances the checkpoint when
 * done. Skips if an incremental job is already queued/running for the connector.
 */
export async function enqueueIncremental(
  supabase: SupabaseLike,
  connector: Pick<ConnectorRow, "id" | "org_id" | "type">
): Promise<{ enqueued: boolean }> {
  const { count } = await supabase
    .from("sync_jobs")
    .select("id", { count: "exact", head: true })
    .eq("connector_id", connector.id)
    .eq("advance_checkpoint", true)
    .in("status", ["pending", "running"]);
  if ((count ?? 0) > 0) return { enqueued: false }; // already catching up

  const { data: row } = await supabase
    .from("connectors")
    .select("synced_through")
    .eq("id", connector.id)
    .maybeSingle();
  const syncedThrough = (row as { synced_through?: string | null } | null)?.synced_through ?? null;

  const now = Date.now();
  const floor = syncedThrough
    ? new Date(syncedThrough).getTime() - OVERLAP_DAYS * DAY_MS
    : now - INITIAL_BACKFILL_DAYS * DAY_MS;

  const { error } = await supabase.from("sync_jobs").insert({
    org_id: connector.org_id,
    connector_id: connector.id,
    type: connector.type,
    window_from: new Date(Math.min(floor, now)).toISOString(),
    window_to: new Date(now).toISOString(),
    advance_checkpoint: true,
  });
  if (error) throw new Error(`Failed to enqueue incremental: ${error.message}`);
  return { enqueued: true };
}

/** Max subscriptions polled per nightly pass. Cashfree has no list-subscriptions
 *  API, so the registry only grows as webhooks arrive; this keeps the nightly
 *  self-heal bounded well within the function budget. Least-recently-polled first,
 *  so over successive nights every subscription is refreshed in rotation. */
export const SUBSCRIPTION_POLL_BATCH = 200;

/**
 * Self-healing net for Cashfree recurring charges (Layer 2). Walks the subscription
 * registry least-recently-polled first and re-fetches each one's payments via
 * GET /pg/subscriptions/{id}/payments — which returns ALL charges (incl. failed,
 * with no settlement wait), so any recurring charge a webhook never delivered is
 * recovered here. Idempotent (dedup on cf_pay_<cf_txn_id>), best-effort, and bounded
 * by both `limit` and `deadlineMs`. Returns counts for logging.
 *
 * NOTE: decrypts connector secrets, so it only works where CONNECTOR_ENC_KEY matches
 * (production). Non-fatal everywhere — a missing table (migration 031 not applied)
 * or decrypt failure just returns zeros.
 */
export async function pollCashfreeSubscriptions(
  supabase: SupabaseLike,
  connector: Pick<ConnectorRow, "id" | "org_id" | "type" | "config">,
  opts: { limit?: number; deadlineMs?: number } = {}
): Promise<{ polled: number; inserted: number; updated: number }> {
  if (connector.type !== "cashfree") return { polled: 0, inserted: 0, updated: 0 };
  const limit = opts.limit ?? SUBSCRIPTION_POLL_BATCH;
  const deadline = opts.deadlineMs ?? Date.now() + 30_000;

  let client: CashfreeConnector;
  try {
    const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
    if (!cfg.client_id || !cfg.client_secret) return { polled: 0, inserted: 0, updated: 0 };
    client = new CashfreeConnector(cfg.client_id, cfg.client_secret);
  } catch {
    return { polled: 0, inserted: 0, updated: 0 };
  }

  let subs: Array<{ subscription_id: string; plan_name: string | null; customer_name: string | null; currency: string | null }>;
  try {
    const { data, error } = await supabase
      .from("cashfree_subscriptions")
      .select("subscription_id, plan_name, customer_name, currency")
      .eq("connector_id", connector.id)
      .order("last_polled_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) return { polled: 0, inserted: 0, updated: 0 }; // table missing / not applied yet
    subs = data ?? [];
  } catch {
    return { polled: 0, inserted: 0, updated: 0 };
  }

  let polled = 0, inserted = 0, updated = 0;
  const polledIds: string[] = [];
  for (const s of subs) {
    if (Date.now() > deadline) break;
    const txns = await client.fetchSubscriptionPayments(s.subscription_id, {
      planName: s.plan_name, customerName: s.customer_name, currency: s.currency,
    });
    if (txns.length > 0) {
      const res = await persistTransactions(supabase, connector.org_id, connector.id, txns);
      inserted += res.inserted;
      updated += res.updated;
      // Fill-only tag: rows that recon inserted BEFORE we knew they were recurring
      // (subscription_id still null) get tagged now. toInsertRows sets it on new rows;
      // this catches the pre-existing ones. Never overwrites (`is null`) → idempotent.
      const extIds = txns.map((t) => t.external_id).filter(Boolean) as string[];
      if (extIds.length > 0) {
        await supabase
          .from("transactions")
          .update({ subscription_id: s.subscription_id })
          .eq("org_id", connector.org_id)
          .in("external_id", extIds)
          .is("subscription_id", null);
      }
    }
    polledIds.push(s.subscription_id);
    polled++;
  }
  // One UPDATE stamps last_polled_at on every subscription actually polled this pass
  // (instead of a round-trip per subscription), so next run rotates to the rest.
  if (polledIds.length > 0) {
    await supabase
      .from("cashfree_subscriptions")
      .update({ last_polled_at: new Date().toISOString() })
      .eq("connector_id", connector.id)
      .in("subscription_id", polledIds);
  }
  return { polled, inserted, updated };
}

/** Claim up to CLAIM_BATCH eligible jobs atomically (FOR UPDATE SKIP LOCKED). */
async function claimBatch(supabase: SupabaseLike, worker: string): Promise<SyncJobRow[]> {
  const { data, error } = await supabase.rpc("claim_sync_jobs", {
    p_batch: CLAIM_BATCH,
    p_worker: worker,
  });
  if (error) throw new Error(`claim_sync_jobs failed: ${error.message}`);
  return (data ?? []) as SyncJobRow[];
}

function backoffRunAfter(attempts: number): string {
  const minutes = Math.min(2 ** (attempts - 1), 30);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function finishJob(
  supabase: SupabaseLike,
  job: SyncJobRow,
  outcome:
    | { ok: true; result: ConnectorSyncResult }
    | { ok: false; error: string; permanent: boolean }
): Promise<void> {
  if (outcome.ok) {
    await supabase
      .from("sync_jobs")
      .update({
        status: "done",
        last_error: null,
        result: {
          inserted: outcome.result.inserted,
          updated: outcome.result.updated,
          skipped: outcome.result.skipped,
          fetched: outcome.result.fetched,
          warnings: outcome.result.warnings,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    return;
  }
  const exhausted = outcome.permanent || job.attempts >= job.max_attempts;
  await supabase
    .from("sync_jobs")
    .update({
      status: exhausted ? "failed" : "pending",
      last_error: outcome.error.slice(0, 500),
      run_after: exhausted ? job.run_after : backoffRunAfter(job.attempts),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

type Outcome = "progress" | "done" | "failed";

/**
 * Process ONE bounded chunk of a resumable (cursor-paginated) job. Fetches up to
 * CHUNK_FETCH_MS worth of one stream from the saved cursor, persists it, then
 * either continues (same stream, new cursor), advances to the next stream, or
 * finishes — saving progress to the row each time. Progress resets `attempts` so
 * a long backfill is never mistaken for a stuck job.
 */
async function processResumableChunk(
  supabase: SupabaseLike,
  job: SyncJobRow,
  connector: ConnectorRow
): Promise<Outcome> {
  const streams = CURSOR_STREAMS[connector.type];
  const stream = job.stream ?? streams[0];

  try {
    const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
    const opts = {
      gteSec: Math.floor(new Date(job.window_from).getTime() / 1000),
      lteSec: Math.floor(new Date(job.window_to).getTime() / 1000),
      startingAfter: job.cursor,
      deadlineMs: Date.now() + CHUNK_FETCH_MS,
    };

    // Dispatch to the connector's resumable client. Both return the same shape
    // ({ transactions, nextCursor, hasMore }) so the cursor/stream advancement
    // below is fully generic — new resumable gateways only add a branch here.
    let chunk: { transactions: NormalizedTransaction[]; nextCursor: string | null; hasMore: boolean };
    if (connector.type === "stripe") {
      if (!cfg.secret_key) throw new SyncConfigError("Connector is missing secret_key in config");
      chunk = await new StripeConnector(cfg.secret_key).fetchChunk(
        stream as "charges" | "payouts" | "disputes", opts);
    } else if (connector.type === "razorpay") {
      if (!cfg.key_id || !cfg.key_secret) throw new SyncConfigError("Connector is missing Razorpay key_id/key_secret");
      chunk = await new RazorpayConnector(cfg.key_id, cfg.key_secret).fetchChunk(
        stream as "payments" | "refunds" | "settlements" | "disputes", opts);
    } else {
      throw new SyncConfigError(`No resumable engine for ${connector.type}`);
    }
    const { transactions, nextCursor, hasMore } = chunk;

    await persistTransactions(supabase, connector.org_id, connector.id, transactions);
    const processed = (job.processed ?? 0) + transactions.length;
    const base = { processed, attempts: 0, locked_at: null, locked_by: null, updated_at: new Date().toISOString() };

    if (hasMore) {
      // More of this stream remains — continue from the new cursor next pass.
      await supabase.from("sync_jobs").update({ ...base, stream, cursor: nextCursor, status: "pending", run_after: new Date().toISOString() }).eq("id", job.id);
      return "progress";
    }

    const idx = streams.indexOf(stream);
    if (idx < streams.length - 1) {
      // Stream done — move to the next stream from the start.
      await supabase.from("sync_jobs").update({ ...base, stream: streams[idx + 1], cursor: null, status: "pending", run_after: new Date().toISOString() }).eq("id", job.id);
      return "progress";
    }

    // All streams done.
    await supabase.from("sync_jobs").update({ ...base, status: "done", cursor: null, result: { processed } }).eq("id", job.id);
    await supabase.from("connectors").update({ last_synced_at: new Date().toISOString() }).eq("id", connector.id);
    if (job.advance_checkpoint) await advanceCheckpoint(supabase, connector.id, new Date(job.window_to));
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const permanent = err instanceof SyncConfigError;
    await finishJob(supabase, job, { ok: false, error: message, permanent });
    return job.attempts >= job.max_attempts || permanent ? "failed" : "progress";
  }
}

/**
 * Resumable historical SUBSCRIPTION + INVOICE backfill (job.type = 'subs').
 * Phases tracked in job.stream: 'subs' → 'invoices' → 'tag'. Each pass fetches a
 * bounded, cursor-paginated slice (so a large history spanning tens of thousands
 * of rows completes across many worker passes instead of timing out), persists
 * the cursor, and re-queues. The final 'tag' phase bridges charges→subscriptions
 * (subscription_id on transactions). Idempotent throughout. Stripe + Razorpay
 * only (Cashfree has no list API). advance_checkpoint is ignored (dimension data).
 */
async function processSubsBackfill(supabase: SupabaseLike, job: SyncJobRow, connector: ConnectorRow): Promise<Outcome> {
  const phase = (job.stream as "subs" | "invoices" | "tag" | null) ?? "subs";
  const fromMs = new Date(job.window_from).getTime();
  const deadlineMs = Date.now() + CHUNK_FETCH_MS;
  const requeue = (extra: Record<string, unknown>) =>
    supabase.from("sync_jobs").update({
      attempts: 0, locked_at: null, locked_by: null, status: "pending",
      run_after: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra,
    }).eq("id", job.id);
  try {
    if (phase === "subs") {
      const r = await syncGatewaySubscriptions(supabase, connector, { fromMs, deadlineMs, cursor: job.cursor });
      const processed = (job.processed ?? 0) + r.fetched;
      if (r.hasMore) { await requeue({ processed, stream: "subs", cursor: r.cursor }); return "progress"; }
      await requeue({ processed, stream: "invoices", cursor: null }); return "progress";
    }
    if (phase === "invoices") {
      const r = await syncGatewayInvoices(supabase, connector, { fromMs, deadlineMs, cursor: job.cursor });
      const processed = (job.processed ?? 0) + r.fetched;
      if (r.hasMore) { await requeue({ processed, stream: "invoices", cursor: r.cursor }); return "progress"; }
      await requeue({ processed, stream: "tag", cursor: null }); return "progress";
    }
    // phase 'tag' — bridge charges → subscriptions, then finish.
    await tagSubscriptionCharges(supabase);
    await supabase.from("sync_jobs").update({
      status: "done", cursor: null, result: { processed: job.processed ?? 0 }, updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const permanent = err instanceof SyncConfigError;
    await finishJob(supabase, job, { ok: false, error: message, permanent });
    return job.attempts >= job.max_attempts || permanent ? "failed" : "progress";
  }
}

/** Process one legacy (whole-window) job for a low-volume connector. */
async function processLegacyJob(supabase: SupabaseLike, job: SyncJobRow, connector: ConnectorRow): Promise<Outcome> {
  try {
    const result = await syncConnectorTransactions({
      supabase,
      connector,
      fromDate: new Date(job.window_from),
      toDate: new Date(job.window_to),
    });
    await finishJob(supabase, job, { ok: true, result });
    if (job.advance_checkpoint) await advanceCheckpoint(supabase, connector.id, new Date(job.window_to));
    return "done";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const permanent = err instanceof SyncConfigError;
    await finishJob(supabase, job, { ok: false, error: message, permanent });
    return job.attempts >= job.max_attempts || permanent ? "failed" : "progress";
  }
}

/**
 * Drain the queue for up to WORKER_BUDGET_MS: claim a batch, process it, repeat
 * until empty or out of budget. Concurrent/overlapping invocations are safe
 * (FOR UPDATE SKIP LOCKED).
 */
export async function drainSyncJobs(
  supabase: SupabaseLike,
  worker: string,
  startedAt: number = Date.now()
): Promise<{ processed: number; done: number; failed: number; progressed: number }> {
  let processed = 0, done = 0, failed = 0, progressed = 0;

  // ── Orphan recovery (runs every pass, before claiming) ─────────────────────
  // A 'running' job whose lock is older than one function lifetime was abandoned
  // when its worker died/timed-out mid-chunk. Recover it here instead of letting
  // it sit invisible until the SQL claim's slower 5-min stale-lock window — that
  // gap is exactly what leaves a backfill "stuck at 95%".
  const orphanCutoff = new Date(Date.now() - RECLAIM_AFTER_MS).toISOString();
  // 1. Under the retry ceiling → requeue so it resumes from its saved cursor on the
  //    very next claim. Resumable jobs lose at most the last chunk (re-upserts
  //    idempotently); attempts is left intact so a job that keeps dying still climbs
  //    toward the ceiling rather than retrying forever.
  await supabase
    .from("sync_jobs")
    .update({ status: "pending", run_after: new Date().toISOString(), locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
    .eq("status", "running")
    .lt("attempts", MAX_RECLAIMS)
    .lt("locked_at", orphanCutoff);
  // 2. At/over the ceiling → genuinely stuck (reclaimed MAX_RECLAIMS times without
  //    ever progressing). Retire it so the queue drains and the bar can complete.
  await supabase
    .from("sync_jobs")
    .update({ status: "failed", last_error: "exceeded retry ceiling", locked_at: null, locked_by: null, updated_at: new Date().toISOString() })
    .eq("status", "running")
    .gte("attempts", MAX_RECLAIMS)
    .lt("locked_at", orphanCutoff);

  while (Date.now() - startedAt < WORKER_BUDGET_MS) {
    const batch = await claimBatch(supabase, worker);
    if (batch.length === 0) break;

    const connectorIds = Array.from(new Set(batch.map((j) => j.connector_id)));
    const { data: connectors } = await supabase.from("connectors").select("*").in("id", connectorIds);
    const byId = new Map((connectors ?? []).map((c) => [c.id, c]));

    const outcomes = await Promise.all(
      batch.map(async (job): Promise<Outcome> => {
        const connector = byId.get(job.connector_id);
        if (!connector) {
          await finishJob(supabase, job, { ok: false, error: "Connector no longer exists", permanent: true });
          return "failed";
        }
        if (job.type === "subs") return processSubsBackfill(supabase, job, connector);
        return isResumable(connector.type)
          ? processResumableChunk(supabase, job, connector)
          : processLegacyJob(supabase, job, connector);
      })
    );

    processed += outcomes.length;
    done += outcomes.filter((o) => o === "done").length;
    failed += outcomes.filter((o) => o === "failed").length;
    progressed += outcomes.filter((o) => o === "progress").length;
  }

  return { processed, done, failed, progressed };
}
