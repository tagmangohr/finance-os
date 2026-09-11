import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Wrap a cron/worker's body so its run is recorded to `cron_runs` (migration 106) for
 * the Sync Health page — start → ok/failed, with duration + error. Best-effort: if the
 * table is missing (pre-migration) or a write fails, it NEVER blocks or breaks the cron;
 * the wrapped work runs and its result/exception is returned/re-thrown unchanged.
 */
export async function recordCronRun<T>(
  supabase: SupabaseClient,
  jobName: string,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>
): Promise<T> {
  const startedAt = new Date();
  let runId: string | null = null;
  try {
    const { data } = await supabase
      .from("cron_runs")
      .insert({ job_name: jobName, status: "running", started_at: startedAt.toISOString(), meta: meta ?? null })
      .select("id")
      .maybeSingle();
    runId = (data?.id as string | undefined) ?? null;
  } catch { /* table not present yet / transient — don't block the cron */ }

  const finish = async (status: "ok" | "failed", error: string | null) => {
    const finishedAt = new Date();
    const patch = {
      status,
      finished_at: finishedAt.toISOString(),
      duration_ms: finishedAt.getTime() - startedAt.getTime(),
      error: error ? error.slice(0, 500) : null,
    };
    try {
      if (runId) await supabase.from("cron_runs").update(patch).eq("id", runId);
      else await supabase.from("cron_runs").insert({ job_name: jobName, started_at: startedAt.toISOString(), meta: meta ?? null, ...patch });
    } catch { /* ignore — logging must never break the job */ }
  };

  try {
    const result = await fn();
    await finish("ok", null);
    return result;
  } catch (err) {
    await finish("failed", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Record a COMPLETED cron run in one shot (no 'running' phase) — for crons whose
 * control flow (early returns, big allSettled bodies) makes the wrapper awkward.
 * Best-effort: never throws. `startedAt` is a Date.now() timestamp captured at the
 * start of the run.
 */
export async function logCronRun(
  supabase: SupabaseClient,
  jobName: string,
  startedAt: number,
  status: "ok" | "failed",
  error?: string | null,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("cron_runs").insert({
      job_name: jobName,
      status,
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      error: error ? error.slice(0, 500) : null,
      meta: meta ?? null,
    });
  } catch { /* logging must never break the job */ }
}
