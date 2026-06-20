import type { createServiceClient } from "@/lib/supabase/server";
import type { ConnectorSyncResult } from "@/lib/connectors/sync";
import { syncConnectorTransactions, SyncConfigError } from "@/lib/connectors/sync";
import type { Database, SyncJobRow } from "@/lib/supabase/types";

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Each job covers at most this many days — keeps every unit well under the
 *  function budget so a single job can never time out. */
export const JOB_WINDOW_DAYS = 14;
/** How many jobs a single worker invocation claims per batch. Kept small so a few
 *  heavy paginations don't compete for the function budget or trip provider rate
 *  limits; the worker loops batches until its time budget. */
export const CLAIM_BATCH = 3;
/** Stop claiming new batches once the worker has used this much of its budget. */
export const WORKER_BUDGET_MS = 50_000;

/**
 * Split [from, to] into bounded windows and enqueue one job per window.
 * Returns the number of jobs created. Safe to call repeatedly — duplicate
 * windows just re-sync the same data, which dedup makes a no-op.
 */
export async function enqueueBackfill(
  supabase: SupabaseLike,
  connector: Pick<ConnectorRow, "id" | "org_id" | "type">,
  fromDate: Date,
  toDate: Date
): Promise<number> {
  const rows: Database["public"]["Tables"]["sync_jobs"]["Insert"][] = [];
  let cursor = fromDate.getTime();
  const end = toDate.getTime();
  const stepMs = JOB_WINDOW_DAYS * DAY_MS;

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
  // Exponential-ish: 1m, 2m, 4m, 8m … capped at 30m.
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

  // Retry until max_attempts, then give up. attempts was already incremented at claim.
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

/**
 * Drain the queue for up to WORKER_BUDGET_MS: claim a batch, process it, repeat
 * until empty or out of budget. Returns a small summary for logging.
 */
export async function drainSyncJobs(
  supabase: SupabaseLike,
  worker: string,
  startedAt: number = Date.now()
): Promise<{ processed: number; done: number; failed: number; requeued: number }> {
  let processed = 0, done = 0, failed = 0, requeued = 0;

  while (Date.now() - startedAt < WORKER_BUDGET_MS) {
    const batch = await claimBatch(supabase, worker);
    if (batch.length === 0) break;

    // Load the connectors for this batch once.
    const connectorIds = Array.from(new Set(batch.map((j) => j.connector_id)));
    const { data: connectors } = await supabase
      .from("connectors")
      .select("*")
      .in("id", connectorIds);
    const byId = new Map((connectors ?? []).map((c) => [c.id, c]));

    const outcomes = await Promise.all(
      batch.map(async (job) => {
        const connector = byId.get(job.connector_id);
        if (!connector) {
          await finishJob(supabase, job, {
            ok: false,
            error: "Connector no longer exists",
            permanent: true,
          });
          return "failed" as const;
        }
        try {
          const result = await syncConnectorTransactions({
            supabase,
            connector,
            fromDate: new Date(job.window_from),
            toDate: new Date(job.window_to),
          });
          await finishJob(supabase, job, { ok: true, result });
          return "done" as const;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          // Config errors won't fix themselves — fail fast, don't waste retries.
          const permanent = err instanceof SyncConfigError;
          await finishJob(supabase, job, { ok: false, error: message, permanent });
          return job.attempts >= job.max_attempts || permanent
            ? ("failed" as const)
            : ("requeued" as const);
        }
      })
    );

    processed += outcomes.length;
    done     += outcomes.filter((o) => o === "done").length;
    failed   += outcomes.filter((o) => o === "failed").length;
    requeued += outcomes.filter((o) => o === "requeued").length;
  }

  return { processed, done, failed, requeued };
}
