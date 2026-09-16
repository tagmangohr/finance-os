/**
 * Canonical registry of the scheduled jobs (Vercel crons in vercel.json). ONE source of
 * truth for their human label, plain-language description, schedule, staleness threshold,
 * and whether they're load-bearing ("critical"). Imported by lib/ops/health.ts (to build
 * the Sync Health view), the toggle API (to validate a job name), and surfaced to the
 * client (descriptions + critical flag) so nothing drifts.
 *
 * `staleHours`: how long after its last run a cron is considered "overdue".
 * `dailyish`: a low-frequency job that has simply never run yet reads as "scheduled"
 *   (neutral) rather than a problem — a high-frequency one with no runs is "overdue".
 * `critical`: turning it OFF halts core syncing/reconciliation platform-wide, so the UI
 *   asks for a confirm before disabling it. (mercury-balances is important but not core —
 *   it only affects the Bank cash figure, so it's a plain toggle.)
 */
export type CronDef = {
  jobName: string;
  label: string;
  description: string;
  schedule: string;
  staleHours: number;
  dailyish: boolean;
  critical: boolean;
};

export const CRON_DEFS: CronDef[] = [
  {
    jobName: "nightly-sync",
    label: "Nightly reconcile",
    description:
      "Every night, pulls the latest transactions from every connected account and re-checks the whole financial year so refunds, disputes and status changes are caught — the main daily sync.",
    schedule: "Daily · 00:30 IST",
    staleHours: 30,
    dailyish: true,
    critical: true,
  },
  {
    jobName: "mercury-balances",
    label: "Mercury balances",
    description:
      "Every night, refreshes your Mercury bank balances (checking, savings and treasury) so the Bank page's cash-on-hand and runway stay current.",
    schedule: "Daily · 00:30 IST",
    staleHours: 30,
    dailyish: true,
    critical: false,
  },
  {
    jobName: "snapshot",
    label: "Snapshot & rollups",
    description:
      "Every morning, rebuilds the pre-computed metric rollups from the raw ledger (self-healing any drift) and saves a daily snapshot of cash, MRR, burn and runway for the dashboards.",
    schedule: "Daily · 07:30 IST",
    staleHours: 30,
    dailyish: true,
    critical: true,
  },
  {
    jobName: "process-sync-jobs",
    label: "Sync queue worker",
    description:
      "Runs every minute to drain the background sync queue — the engine that actually fetches and imports data from every connector. Disabling it stops all syncing.",
    schedule: "Every minute",
    staleHours: 0.5,
    dailyish: false,
    critical: true,
  },
  {
    jobName: "deliver-webhooks",
    label: "Outbound webhooks",
    description:
      "Runs every minute to deliver your outgoing webhook events to the external URLs you've configured, retrying any that fail.",
    schedule: "Every minute",
    staleHours: 0.5,
    dailyish: false,
    critical: false,
  },
  {
    jobName: "fx-backfill",
    label: "FX backfill",
    description:
      "Runs every 5 minutes to convert foreign-currency transactions to INR using ECB rates, filling any amounts imported without a converted value.",
    schedule: "Every 5 minutes",
    staleHours: 1,
    dailyish: false,
    critical: false,
  },
  {
    jobName: "drive-sync",
    label: "Drive sync",
    description:
      "Runs hourly to check linked Google Sheets / Drive files for changes and re-import them whenever the source has been updated.",
    schedule: "Hourly",
    staleHours: 3,
    dailyish: false,
    critical: false,
  },
];

/** Display + processing order (matches the list on the Sync Health page). */
export const CRON_ORDER: string[] = CRON_DEFS.map((c) => c.jobName);

export const CRON_BY_NAME: Record<string, CronDef> = Object.fromEntries(
  CRON_DEFS.map((c) => [c.jobName, c])
);

/** The set of job names the toggle API will accept — exactly the scheduled crons.
 * (Internal/derived jobs like `sub-dupe-watch` are NOT toggleable.) */
export const TOGGLEABLE_JOBS: Set<string> = new Set(CRON_ORDER);
