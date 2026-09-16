import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * On/Off state for the scheduled crons (cron_settings, migration 129). Vercel fires the
 * crons on a static schedule; these helpers let each route gate itself and let the Sync
 * Health page reflect + flip that state.
 *
 * DEFAULT-ON everywhere: a missing row — or the table not existing yet (pre-migration) —
 * means ENABLED. So shipping the gate before the migration, or a brand-new cron with no
 * row, never silently halts a job. Only an explicit `enabled = false` pauses one. All
 * reads are best-effort (try/catch) so cron_settings can never break a cron or the page.
 */

/** Map of jobName → enabled for every row present. Absent jobs are enabled (default-on). */
export async function getCronEnabledMap(supabase: SupabaseClient): Promise<Record<string, boolean>> {
  try {
    const { data } = await supabase.from("cron_settings").select("job_name, enabled");
    const map: Record<string, boolean> = {};
    for (const r of data ?? []) map[r.job_name as string] = r.enabled as boolean;
    return map;
  } catch {
    return {}; // table missing / transient — treat everything as enabled
  }
}

/** Whether a single cron may run now. True unless an explicit row says disabled. */
export async function isCronEnabled(supabase: SupabaseClient, jobName: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("cron_settings")
      .select("enabled")
      .eq("job_name", jobName)
      .maybeSingle();
    return data ? (data.enabled as boolean) : true;
  } catch {
    return true; // never let the settings lookup itself stop a cron
  }
}

/** Upsert a cron's enabled state (owner/admin action — caller enforces auth). Records who
 * flipped it and when. Throws on failure so the API can surface it (unlike the read paths,
 * a failed WRITE should not be silently swallowed). */
export async function setCronEnabled(
  supabase: SupabaseClient,
  jobName: string,
  enabled: boolean,
  userId: string | null
): Promise<void> {
  const { error } = await supabase.from("cron_settings").upsert(
    { job_name: jobName, enabled, updated_at: new Date().toISOString(), updated_by: userId },
    { onConflict: "job_name" }
  );
  if (error) throw new Error(error.message);
}
