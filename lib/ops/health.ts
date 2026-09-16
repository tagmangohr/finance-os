import type { createServiceClient } from "@/lib/supabase/server";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export type SyncJobLite = {
  id: string;
  status: string;
  window_from: string | null;
  window_to: string | null;
  attempts: number;
  last_error: string | null;
  processed: number | null;
  updated_at: string;
};

export type ConnectorHealth = {
  id: string;
  type: string;
  name: string | null;
  status: string;
  syncedThrough: string | null;
  lastSyncedAt: string | null;
  health: "green" | "amber" | "red";
  failedJobs: number;
  reason: string | null;
  jobs: SyncJobLite[];
};

export type CronRunLite = {
  status: "running" | "ok" | "failed" | string;
  at: string;
  durationMs: number | null;
  error: string | null;
};

export type CronHealth = {
  jobName: string;
  label: string;
  schedule: string;
  lastStatus: "ok" | "failed" | "running" | "none";
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  health: "green" | "amber" | "red";
  /** "ok" | "failed" | "overdue" | "scheduled" — drives the human label. */
  state: "ok" | "failed" | "overdue" | "scheduled";
  runs: CronRunLite[]; // recent history, newest first (the audit log)
};

export type HealthSummary = {
  connectorsTotal: number;
  connectorsGreen: number;
  connectorsAmber: number;
  connectorsRed: number;
  cronsTotal: number;
  cronsGreen: number;
  cronsAmber: number;
  cronsRed: number;
};

export type SyncHealthData = {
  connectors: ConnectorHealth[];
  crons: CronHealth[];
  redFlags: string[];
  summary: HealthSummary;
  generatedAt: string;
};

const STALE_HOURS = 48; // an active POLLED connector that hasn't synced in this long → amber
// Only POLLED connectors get the stale-since-last-sync check. Webhook-only connectors
// (App Store, Brex) never set last_synced_at from a poll, so staleness there is
// meaningless — flag them only on actual failed/erroring jobs.
const POLLED_TYPES = new Set(["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz", "mercury", "google_sheets", "excel"]);

// Every Vercel cron (vercel.json) + the sub-dupe watchdog it runs. `staleHours` is how
// long after its last run a cron is "overdue"; `dailyish` crons that have simply never
// run yet read as "scheduled" (neutral) rather than a problem.
const CRON_META: Record<string, { label: string; schedule: string; staleHours: number; dailyish: boolean }> = {
  "nightly-sync":      { label: "Nightly reconcile",  schedule: "Daily · 00:30 IST", staleHours: 30, dailyish: true },
  "mercury-balances":  { label: "Mercury balances",   schedule: "Daily · 00:30 IST", staleHours: 30, dailyish: true },
  "snapshot":          { label: "Snapshot & rollups", schedule: "Daily · 07:30 IST", staleHours: 30, dailyish: true },
  "process-sync-jobs": { label: "Sync queue worker",  schedule: "Every minute",      staleHours: 0.5, dailyish: false },
  "deliver-webhooks":  { label: "Outbound webhooks",  schedule: "Every minute",      staleHours: 0.5, dailyish: false },
  "fx-backfill":       { label: "FX backfill",        schedule: "Every 5 minutes",   staleHours: 1, dailyish: false },
  "drive-sync":        { label: "Drive sync",         schedule: "Hourly",            staleHours: 3, dailyish: false },
};
const CRON_ORDER = ["nightly-sync", "mercury-balances", "snapshot", "process-sync-jobs", "deliver-webhooks", "fx-backfill", "drive-sync"];

const hoursSince = (iso: string | null): number =>
  iso == null ? Infinity : (Date.now() - new Date(iso).getTime()) / 3_600_000;

const shorten = (s: string | null, n = 140): string | null => (s == null ? null : s.length > n ? s.slice(0, n) + "…" : s);

/**
 * Sync Health for one org: per-connector status (from connectors + recent sync_jobs)
 * plus the system crons (from cron_runs, with recent-run history). Read with the SERVICE
 * client — sync_jobs is member-readable but cron_runs is service-only; the PAGE gates
 * access (grantable "health" page), so the data is fetched server-side and never exposed
 * to the client directly.
 */
export async function getSyncHealth(orgId: string, supabase: ServiceClient): Promise<SyncHealthData> {
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, type, name, status, synced_through, last_synced_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  // Recent jobs for this org's connectors (last ~200 across the org; grouped below).
  const { data: jobRows } = await supabase
    .from("sync_jobs")
    .select("id, connector_id, status, window_from, window_to, attempts, last_error, processed, updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(200);

  const jobsByConnector = new Map<string, SyncJobLite[]>();
  for (const j of jobRows ?? []) {
    const list = jobsByConnector.get(j.connector_id as string) ?? [];
    if (list.length < 12) list.push({
      id: j.id as string, status: j.status as string,
      window_from: j.window_from as string | null, window_to: j.window_to as string | null,
      attempts: (j.attempts as number) ?? 0, last_error: j.last_error as string | null,
      processed: (j.processed as number | null) ?? null, updated_at: j.updated_at as string,
    });
    jobsByConnector.set(j.connector_id as string, list);
  }

  const connectorHealth: ConnectorHealth[] = (connectors ?? []).map((c) => {
    const jobs = jobsByConnector.get(c.id as string) ?? [];
    // A job is "failed" only when it has exhausted retries. A pending/running job that
    // carries a last_error is mid-retry (transient). Resolved "done" jobs no longer keep
    // an error (jobs.ts clears last_error on the success paths), so a lingering error is
    // real, not stale.
    const failed = jobs.filter((j) => j.status === "failed");
    const failedJobs = failed.length;
    const erroringRetry = jobs.find((j) => (j.status === "pending" || j.status === "running") && j.attempts > 0 && j.last_error);
    const active = c.status === "active";
    const stale = active && POLLED_TYPES.has(c.type as string) && hoursSince(c.last_synced_at as string | null) > STALE_HOURS;

    let health: ConnectorHealth["health"] = "green";
    let reason: string | null = null;
    if (failedJobs > 0) {
      health = "red";
      const err = shorten(failed[0].last_error);
      reason = err ? `Sync failing: ${err}` : `${failedJobs} failed sync job${failedJobs === 1 ? "" : "s"}`;
    } else if (erroringRetry) {
      health = "amber";
      reason = `Retrying: ${shorten(erroringRetry.last_error, 100)}`;
    } else if (stale) {
      health = "amber";
      reason = `No successful sync in over ${STALE_HOURS}h`;
    } else if (!active) {
      health = "amber";
      reason = `Connector is ${c.status}`;
    }

    return {
      id: c.id as string, type: c.type as string, name: (c.name as string | null) ?? null,
      status: c.status as string, syncedThrough: c.synced_through as string | null,
      lastSyncedAt: c.last_synced_at as string | null,
      health, failedJobs, reason, jobs,
    };
  });

  // System crons — recent run history per job (one small indexed query each).
  const cronHistories = await Promise.all(
    CRON_ORDER.map(async (jobName) => {
      const { data } = await supabase
        .from("cron_runs")
        .select("status, started_at, duration_ms, error")
        .eq("job_name", jobName)
        .order("started_at", { ascending: false })
        .limit(8);
      return [jobName, (data ?? [])] as const;
    })
  );

  const crons: CronHealth[] = cronHistories.map(([jobName, rows]) => {
    const meta = CRON_META[jobName];
    const runs: CronRunLite[] = rows.map((r) => ({
      status: r.status as string,
      at: r.started_at as string,
      durationMs: (r.duration_ms as number | null) ?? null,
      error: (r.error as string | null) ?? null,
    }));
    const latest = runs[0] ?? null;

    let health: CronHealth["health"];
    let state: CronHealth["state"];
    if (!latest) {
      // Never recorded a run. A daily job simply hasn't fired since instrumentation
      // (neutral); a high-frequency job that has NO runs is overdue (should have fired).
      state = meta.dailyish ? "scheduled" : "overdue";
      health = meta.dailyish ? "green" : "amber";
    } else if (latest.status === "failed") {
      state = "failed"; health = "red";
    } else if (hoursSince(latest.at) > meta.staleHours) {
      state = "overdue"; health = "amber";
    } else {
      state = "ok"; health = "green";
    }

    return {
      jobName,
      label: meta.label,
      schedule: meta.schedule,
      lastStatus: latest ? (latest.status as CronHealth["lastStatus"]) : "none",
      lastRunAt: latest?.at ?? null,
      lastDurationMs: latest?.durationMs ?? null,
      lastError: shorten(latest?.error ?? null),
      health,
      state,
      runs,
    };
  });

  // Cashfree recurring-charge double-count watchdog. The nightly sync runs the actual
  // 30-day scan (detectCashfreeSubDoubleCounts) across all orgs and records a per-org
  // count in the `sub-dupe-watch` cron_runs meta — so here we just read that latest
  // result cheaply. Baseline is 0; freshness is ~last night. Non-fatal.
  let subDupeFlag: string | null = null;
  try {
    const { data: watch } = await supabase
      .from("cron_runs")
      .select("meta")
      .eq("job_name", "sub-dupe-watch")
      .eq("status", "ok")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const byOrg = ((watch?.meta as { byOrg?: Record<string, number> } | null)?.byOrg) ?? {};
    const n = byOrg[orgId] ?? 0;
    if (n > 0) {
      subDupeFlag = `${n} possible duplicate subscription charge${n === 1 ? "" : "s"} flagged by last night's check — the same amount booked twice on one day for one subscription (check Subscriptions/Payments)`;
    }
  } catch { /* watchdog is best-effort; never fail the health page on it */ }

  const redFlags: string[] = [
    ...connectorHealth.filter((c) => c.health === "red").map((c) => `${c.name ?? c.type}: ${c.reason}`),
    // A failed cron is always a red flag. An overdue high-frequency cron is a red flag
    // ONLY once it has actually run before and then gone stale (queue/webhooks stopped
    // draining) — a high-frequency cron with NO runs yet (e.g. just after instrumentation
    // deploys, before its first tick) is a "watch", not an alarm; a daily cron never
    // alarms on staleness here.
    ...crons
      .filter((c) => c.state === "failed" || (c.state === "overdue" && c.lastRunAt != null && !CRON_META[c.jobName].dailyish))
      .map((c) => c.state === "failed"
        ? `Cron "${c.label}" last run failed${c.lastError ? `: ${c.lastError}` : ""}`
        : `Cron "${c.label}" is overdue — last ran ${c.lastRunAt ? new Date(c.lastRunAt).toISOString() : "never"}`),
    ...(subDupeFlag ? [subDupeFlag] : []),
  ];

  const summary: HealthSummary = {
    connectorsTotal: connectorHealth.length,
    connectorsGreen: connectorHealth.filter((c) => c.health === "green").length,
    connectorsAmber: connectorHealth.filter((c) => c.health === "amber").length,
    connectorsRed: connectorHealth.filter((c) => c.health === "red").length,
    cronsTotal: crons.length,
    cronsGreen: crons.filter((c) => c.health === "green").length,
    cronsAmber: crons.filter((c) => c.health === "amber").length,
    cronsRed: crons.filter((c) => c.health === "red").length,
  };

  return { connectors: connectorHealth, crons, redFlags, summary, generatedAt: new Date().toISOString() };
}
