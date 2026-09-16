"use client";

import { useState, useCallback, useMemo } from "react";
import { RefreshCw, ChevronRight, AlertTriangle, CheckCircle2, Clock, PauseCircle } from "lucide-react";
import { SectionCard } from "@/components/dashboard/section-card";
import { cn, formatDateRelative } from "@/lib/utils";
import type { SyncHealthData, ConnectorHealth, CronHealth, SyncJobLite } from "@/lib/ops/health";

type Level = "green" | "amber" | "red";
const DOT: Record<Level, string> = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-rose-500" };
const rel = (iso: string | null) => (iso ? formatDateRelative(iso) : "never");
const secs = (ms: number | null) => (ms != null ? ` · ${(ms / 1000).toFixed(1)}s` : "");

function HealthDot({ level }: { level: Level }) {
  return <span className={cn("inline-block w-2.5 h-2.5 rounded-full flex-shrink-0", DOT[level])} />;
}

/** Small pill switch (no shared Switch component in the repo — mirrors settings-client). */
function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: "emerald" | "amber" | "rose" | "muted" }) {
  const active = n > 0;
  const color =
    tone === "emerald" ? "text-emerald-600" :
    tone === "amber" ? "text-amber-600" :
    tone === "muted" ? "text-foreground/70" :
    "text-rose-600";
  return (
    <div className="flex items-baseline gap-1">
      <span className={cn("text-[18px] font-bold tabular-nums leading-none", active ? color : "text-muted-foreground/40")}>{n}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function SummaryStrip({ summary }: { summary: SyncHealthData["summary"] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="rounded-xl border border-border bg-card p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Connectors</p>
        <div className="flex items-baseline gap-4 mt-2">
          <Stat n={summary.connectorsGreen} label="healthy" tone="emerald" />
          <Stat n={summary.connectorsAmber} label="watch" tone="amber" />
          <Stat n={summary.connectorsRed} label="failing" tone="rose" />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Scheduled jobs</p>
        <div className="flex items-baseline gap-4 mt-2">
          <Stat n={summary.cronsGreen} label="ok" tone="emerald" />
          <Stat n={summary.cronsAmber} label="overdue" tone="amber" />
          <Stat n={summary.cronsRed} label="failed" tone="rose" />
          {summary.cronsOff > 0 && <Stat n={summary.cronsOff} label="off" tone="muted" />}
        </div>
      </div>
    </div>
  );
}

function JobRow({ j }: { j: SyncJobLite }) {
  const tone = j.status === "failed" ? "text-rose-600" : j.status === "done" ? "text-emerald-600" : "text-amber-600";
  return (
    <div className="px-4 py-2 border-t border-border/30 text-[11.5px]">
      <div className="flex items-center gap-3">
        <span className={cn("font-medium w-16 flex-shrink-0", tone)}>{j.status}</span>
        <span className="text-muted-foreground flex-1 truncate">
          {j.window_from ? new Date(j.window_from).toISOString().slice(0, 10) : "—"} →{" "}
          {j.window_to ? new Date(j.window_to).toISOString().slice(0, 10) : "—"}
          {j.attempts > 1 ? ` · ${j.attempts} attempts` : ""}
          {j.processed != null ? ` · ${j.processed} rows` : ""}
        </span>
        <span className="text-muted-foreground/70 flex-shrink-0">{rel(j.updated_at)}</span>
      </div>
      {j.last_error && <p className="mt-1 text-rose-600/90 break-words">{j.last_error}</p>}
    </div>
  );
}

function ConnectorCard({ c }: { c: ConnectorHealth }) {
  const [open, setOpen] = useState(false);
  const hasJobs = c.jobs.length > 0;
  return (
    <div className={cn("rounded-xl border bg-card", c.health === "red" ? "border-rose-500/30" : c.health === "amber" ? "border-amber-500/25" : "border-border")}>
      <button
        type="button"
        onClick={() => hasJobs && setOpen((v) => !v)}
        className={cn("w-full px-4 py-3 flex items-center gap-3 text-left", hasJobs && "hover:bg-accent/40")}
      >
        {hasJobs ? <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", open && "rotate-90")} /> : <span className="w-3.5" />}
        <HealthDot level={c.health} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground truncate">{c.name || c.type}</p>
          <p className="text-[11px] text-muted-foreground">
            {c.type} · last sync {rel(c.lastSyncedAt)}
            {c.syncedThrough ? ` · caught up to ${new Date(c.syncedThrough).toISOString().slice(0, 10)}` : ""}
          </p>
        </div>
        {c.reason && c.health !== "red" && (
          <span className="text-[11px] flex-shrink-0 text-amber-600 max-w-[35%] truncate" title={c.reason}>{c.reason}</span>
        )}
      </button>
      {/* Red reasons (which now carry the actual error text) get a full-width line so
          the message is readable rather than truncated in the header. */}
      {c.reason && c.health === "red" && (
        <p className="px-4 pb-2.5 -mt-1 text-[11.5px] text-rose-600/90 break-words">{c.reason}</p>
      )}
      {open && hasJobs && (
        <div className="bg-muted/20 rounded-b-xl">
          {c.jobs.map((j) => <JobRow key={j.id} j={j} />)}
        </div>
      )}
    </div>
  );
}

const STATE_BADGE: Record<CronHealth["state"], [string, string]> = {
  ok:        ["text-emerald-600 bg-emerald-500/10", "OK"],
  failed:    ["text-rose-600 bg-rose-500/10", "Failed"],
  overdue:   ["text-amber-600 bg-amber-500/10", "Overdue"],
  scheduled: ["text-muted-foreground bg-muted", "Scheduled"],
  off:       ["text-muted-foreground bg-muted", "Off"],
};

function CronCard({
  c, isOn, busy, canToggle, onToggle,
}: {
  c: CronHealth;
  isOn: boolean;
  busy: boolean;
  canToggle: boolean;
  onToggle: (c: CronHealth, next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasRuns = c.runs.length > 0;
  // Local switch state is the source of truth for On/Off; run-status (OK/Failed/…) only
  // matters while On. When Off, show a neutral grey "Off" chip and dim the card. When a
  // just-re-enabled cron hasn't recomputed yet (server still says "off"), show neutral.
  const runState: CronHealth["state"] = !isOn ? "off" : c.state === "off" ? "scheduled" : c.state;
  const level: Level = !isOn ? "green" : c.state === "off" ? "green" : c.health;
  const [cls, label] = STATE_BADGE[runState];
  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-opacity",
        level === "red" ? "border-rose-500/30" : level === "amber" ? "border-amber-500/25" : "border-border",
        !isOn && "opacity-70"
      )}
    >
      <div className="w-full px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => hasRuns && setOpen((v) => !v)}
          className={cn("flex items-center gap-3 text-left min-w-0 flex-1 -my-1 py-1 rounded-lg", hasRuns && "hover:bg-accent/40")}
        >
          {hasRuns ? <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform flex-shrink-0", open && "rotate-90")} /> : <span className="w-3.5 flex-shrink-0" />}
          <HealthDot level={level} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-foreground truncate">
              {c.label}
              {c.critical && <span className="ml-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-amber-600/90 align-middle">core</span>}
            </p>
            <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">{c.description}</p>
            <p className="text-[10.5px] text-muted-foreground/60 font-mono mt-0.5">{c.jobName} · {c.schedule}</p>
          </div>
        </button>
        <div className="text-right flex-shrink-0">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5", cls)}>{label}</span>
          <p className="text-[10.5px] text-muted-foreground/70 mt-1">
            {!isOn ? "turned off" : c.lastRunAt ? `ran ${rel(c.lastRunAt)}` : "no runs yet"}{isOn ? secs(c.lastDurationMs) : ""}
          </p>
        </div>
        {canToggle && (
          <Switch checked={isOn} disabled={busy} onChange={(next) => onToggle(c, next)} />
        )}
      </div>
      {isOn && c.lastError && <p className="px-4 pb-2.5 -mt-1 text-[11px] text-rose-600/90 break-words">{c.lastError}</p>}
      {open && hasRuns && (
        <div className="bg-muted/20 rounded-b-xl border-t border-border/30">
          {c.runs.map((r, i) => (
            <div key={i} className="px-4 py-1.5 flex items-center gap-3 text-[11px] border-b border-border/20 last:border-0">
              <span className={cn("w-14 flex-shrink-0 font-medium", r.status === "failed" ? "text-rose-600" : r.status === "ok" ? "text-emerald-600" : "text-amber-600")}>{r.status}</span>
              <span className="text-muted-foreground flex-1 truncate">{rel(r.at)}{secs(r.durationMs)}</span>
              {r.error && <span className="text-rose-600/80 flex-shrink-0 max-w-[50%] truncate" title={r.error}>{r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Job-specific consequence shown in the confirm dialog before disabling a core cron. */
const OFF_WARNING: Record<string, string> = {
  "nightly-sync": "the nightly reconcile won't run, so new transactions, refunds and disputes won't be pulled in overnight",
  "process-sync-jobs": "the background queue stops draining, so nothing from any connector will import until it's back on",
  "snapshot": "metric rollups won't rebuild and daily snapshots won't update, so dashboard numbers can drift and go stale",
};

export function HealthClient({ data, canToggle }: { data: SyncHealthData; canToggle: boolean }) {
  const hasRed = data.redFlags.length > 0;
  const watchCount = data.summary.connectorsAmber + data.summary.cronsAmber;

  // On/Off state per cron, seeded from the server and flipped optimistically. `busy`
  // disables a row's switch while its request is in flight; an error reverts + surfaces.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(
    () => Object.fromEntries(data.crons.map((c) => [c.jobName, c.enabled]))
  );
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);

  const toggleCron = useCallback((c: CronHealth, next: boolean) => {
    // Confirm before turning OFF a load-bearing job (platform-wide impact).
    if (!next && c.critical) {
      const consequence = OFF_WARNING[c.jobName] ?? "this core job will stop running";
      const ok = window.confirm(
        `Turn OFF “${c.label}”?\n\nWhile it's off, ${consequence}. This affects every organization on this deployment until you switch it back on.`
      );
      if (!ok) return;
    }
    setToggleError(null);
    setEnabled((m) => ({ ...m, [c.jobName]: next }));           // optimistic
    setBusy((b) => { const n = new Set(b); n.add(c.jobName); return n; });
    void (async () => {
      try {
        const r = await fetch("/api/ops/cron-toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobName: c.jobName, enabled: next }),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `Request failed (${r.status})`);
        }
      } catch (e) {
        setEnabled((m) => ({ ...m, [c.jobName]: !next }));       // revert
        setToggleError(`Couldn't update “${c.label}”: ${e instanceof Error ? e.message : "unknown error"}`);
      } finally {
        setBusy((b) => { const n = new Set(b); n.delete(c.jobName); return n; });
      }
    })();
  }, []);

  // Cron counts derived from LOCAL enabled state (mirrors CronCard's level logic) so the
  // summary strip + off notice move the instant a switch flips, not only on Refresh.
  // Connector counts stay server-computed (they can't change from this page).
  const cronCounts = useMemo(() => {
    let green = 0, amber = 0, red = 0, off = 0;
    for (const c of data.crons) {
      if (enabled[c.jobName] === false) { off++; continue; }
      const level: Level = c.state === "off" ? "green" : c.health;
      if (level === "red") red++;
      else if (level === "amber") amber++;
      else green++;
    }
    return { green, amber, red, off };
  }, [data.crons, enabled]);

  const summary: SyncHealthData["summary"] = {
    ...data.summary,
    cronsGreen: cronCounts.green,
    cronsAmber: cronCounts.amber,
    cronsRed: cronCounts.red,
    cronsOff: cronCounts.off,
  };
  const offCount = cronCounts.off;

  return (
    <div className="space-y-5 max-w-[1100px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[17px] font-semibold text-foreground">Sync Health</h1>
          <p className="text-[12px] text-muted-foreground">Connector syncs + scheduled jobs · updated {rel(data.generatedAt)}</p>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground rounded-lg border border-border px-2.5 py-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {toggleError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-3 text-[12px] text-rose-600 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {toggleError}
        </div>
      )}

      {/* Status banner */}
      {hasRed ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2 text-rose-600">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-[13px] font-semibold">{data.redFlags.length} issue{data.redFlags.length === 1 ? "" : "s"} need attention</span>
          </div>
          <ul className="space-y-1 text-[12px] text-foreground/90">
            {data.redFlags.map((f, i) => <li key={i} className="flex gap-2"><span className="text-rose-500 flex-shrink-0">•</span><span className="break-words">{f}</span></li>)}
          </ul>
        </div>
      ) : watchCount > 0 ? (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] p-4 flex items-center gap-2 text-amber-600">
          <Clock className="w-4 h-4 flex-shrink-0" />
          <span className="text-[13px] font-medium">Critical jobs are running — {watchCount} item{watchCount === 1 ? "" : "s"} to keep an eye on (stale or awaiting a first run).</span>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4 flex items-center gap-2 text-emerald-600">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span className="text-[13px] font-medium">Everything is syncing normally.</span>
        </div>
      )}

      {/* Paused-jobs notice — surfaced regardless of the health banner so a turned-off
          cron is never forgotten (it looks the same as a broken one otherwise). */}
      {offCount > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 p-3.5 flex items-center gap-2 text-muted-foreground">
          <PauseCircle className="w-4 h-4 flex-shrink-0" />
          <span className="text-[12.5px]">
            {offCount} scheduled job{offCount === 1 ? " is" : "s are"} turned off — {offCount === 1 ? "it won't" : "they won't"} run until switched back on below.
          </span>
        </div>
      )}

      <SummaryStrip summary={summary} />

      <SectionCard title="Connectors" subtitle={`${data.connectors.length} connector${data.connectors.length === 1 ? "" : "s"} · click a row for its recent sync runs`}>
        {data.connectors.length === 0 ? (
          <p className="p-4 text-center text-[12px] text-muted-foreground">No connectors yet.</p>
        ) : (
          <div className="space-y-2">{data.connectors.map((c) => <ConnectorCard key={c.id} c={c} />)}</div>
        )}
      </SectionCard>

      <SectionCard title="Scheduled jobs" subtitle={`All ${data.crons.length} crons · click a row for its recent run history`}>
        <div className="space-y-2">{data.crons.map((c) => (
          <CronCard
            key={c.jobName}
            c={c}
            isOn={enabled[c.jobName] !== false}
            busy={busy.has(c.jobName)}
            canToggle={canToggle}
            onToggle={toggleCron}
          />
        ))}</div>
      </SectionCard>
    </div>
  );
}
