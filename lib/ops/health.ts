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

export type CronHealth = {
  jobName: string;
  lastStatus: "ok" | "failed" | "running" | "none";
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  health: "green" | "amber" | "red";
};

export type SyncHealthData = {
  connectors: ConnectorHealth[];
  crons: CronHealth[];
  redFlags: string[];
  generatedAt: string;
};

const STALE_HOURS = 48;         // an active connector that hasn't synced in this long → amber
// Only POLLED connectors get the stale-since-last-sync check. Webhook-only connectors
// (App Store, Brex) never set last_synced_at from a poll, so staleness there is
// meaningless — flag them only on actual failed jobs.
const POLLED_TYPES = new Set(["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz", "mercury", "google_sheets", "excel"]);
const CRON_STALE: Record<string, number> = {   // hours after which a cron's last run is "stale"
  "nightly-sync": 30, "snapshot": 30, "fx-backfill": 1, "drive-sync": 3,
};
const CRON_JOBS = ["nightly-sync", "snapshot", "fx-backfill", "drive-sync"];

const hoursSince = (iso: string | null): number =>
  iso == null ? Infinity : (Date.now() - new Date(iso).getTime()) / 3_600_000;

/**
 * Sync Health for one org: per-connector status (from connectors + recent sync_jobs)
 * plus the system crons (from cron_runs). Read with the SERVICE client — sync_jobs is
 * member-readable but cron_runs is service-only; the PAGE gates access (grantable
 * "health" page), so the data is fetched server-side and never exposed to the client
 * directly. Bounded queries (few connectors, recent jobs), so no pagination needed.
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
    const failedJobs = jobs.filter((j) => j.status === "failed").length;
    const active = c.status === "active";
    const stale = active && POLLED_TYPES.has(c.type as string) && hoursSince(c.last_synced_at as string | null) > STALE_HOURS;
    const retrying = jobs.some((j) => (j.status === "pending" || j.status === "running") && j.attempts > 0);

    let health: ConnectorHealth["health"] = "green";
    let reason: string | null = null;
    if (failedJobs > 0) { health = "red"; reason = `${failedJobs} failed sync job${failedJobs === 1 ? "" : "s"} — sync is stalled here`; }
    else if (stale) { health = "amber"; reason = `No successful sync in over ${STALE_HOURS}h`; }
    else if (retrying) { health = "amber"; reason = "Retrying after an earlier failure"; }
    else if (!active) { health = "amber"; reason = `Connector is ${c.status}`; }

    return {
      id: c.id as string, type: c.type as string, name: (c.name as string | null) ?? null,
      status: c.status as string, syncedThrough: c.synced_through as string | null,
      lastSyncedAt: c.last_synced_at as string | null,
      health, failedJobs, reason, jobs,
    };
  });

  // System crons — latest run per job.
  const { data: cronRows } = await supabase
    .from("cron_runs")
    .select("job_name, status, started_at, finished_at, duration_ms, error")
    .in("job_name", CRON_JOBS)
    .order("started_at", { ascending: false })
    .limit(60);

  const latestByCron = new Map<string, NonNullable<typeof cronRows>[number]>();
  for (const r of cronRows ?? []) {
    if (!latestByCron.has(r.job_name as string)) latestByCron.set(r.job_name as string, r);
  }

  const crons: CronHealth[] = CRON_JOBS.map((jobName) => {
    const r = latestByCron.get(jobName);
    if (!r) return { jobName, lastStatus: "none", lastRunAt: null, lastDurationMs: null, lastError: null, health: "amber" };
    const staleH = CRON_STALE[jobName] ?? 30;
    const isStale = hoursSince((r.started_at as string) ?? null) > staleH;
    const status = r.status as CronHealth["lastStatus"];
    const health: CronHealth["health"] = status === "failed" ? "red" : isStale ? "amber" : "green";
    return {
      jobName,
      lastStatus: status,
      lastRunAt: (r.started_at as string) ?? null,
      lastDurationMs: (r.duration_ms as number | null) ?? null,
      lastError: (r.error as string | null) ?? null,
      health,
    };
  });

  const redFlags: string[] = [
    ...connectorHealth.filter((c) => c.health === "red").map((c) => `${c.name ?? c.type}: ${c.reason}`),
    ...crons.filter((c) => c.health === "red").map((c) => `Cron "${c.jobName}" last run failed`),
  ];

  return { connectors: connectorHealth, crons, redFlags, generatedAt: new Date().toISOString() };
}
