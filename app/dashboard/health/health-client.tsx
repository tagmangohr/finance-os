"use client";

import { useState } from "react";
import { RefreshCw, ChevronRight, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
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

function Stat({ n, label, tone }: { n: number; label: string; tone: "emerald" | "amber" | "rose" }) {
  const active = n > 0;
  const color = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-rose-600";
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
};

function CronCard({ c }: { c: CronHealth }) {
  const [open, setOpen] = useState(false);
  const hasRuns = c.runs.length > 0;
  const [cls, label] = STATE_BADGE[c.state];
  return (
    <div className={cn("rounded-xl border bg-card", c.health === "red" ? "border-rose-500/30" : c.health === "amber" ? "border-amber-500/25" : "border-border")}>
      <button
        type="button"
        onClick={() => hasRuns && setOpen((v) => !v)}
        className={cn("w-full px-4 py-3 flex items-center gap-3 text-left", hasRuns && "hover:bg-accent/40")}
      >
        {hasRuns ? <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", open && "rotate-90")} /> : <span className="w-3.5" />}
        <HealthDot level={c.health} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-foreground truncate">{c.label}</p>
          <p className="text-[11px] text-muted-foreground font-mono">{c.jobName} · {c.schedule}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <span className={cn("text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5", cls)}>{label}</span>
          <p className="text-[10.5px] text-muted-foreground/70 mt-1">
            {c.lastRunAt ? `ran ${rel(c.lastRunAt)}` : "no runs yet"}{secs(c.lastDurationMs)}
          </p>
        </div>
      </button>
      {c.lastError && <p className="px-4 pb-2.5 -mt-1 text-[11px] text-rose-600/90 break-words">{c.lastError}</p>}
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

export function HealthClient({ data }: { data: SyncHealthData }) {
  const hasRed = data.redFlags.length > 0;
  const watchCount = data.summary.connectorsAmber + data.summary.cronsAmber;

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

      <SummaryStrip summary={data.summary} />

      <SectionCard title="Connectors" subtitle={`${data.connectors.length} connector${data.connectors.length === 1 ? "" : "s"} · click a row for its recent sync runs`}>
        {data.connectors.length === 0 ? (
          <p className="p-4 text-center text-[12px] text-muted-foreground">No connectors yet.</p>
        ) : (
          <div className="space-y-2">{data.connectors.map((c) => <ConnectorCard key={c.id} c={c} />)}</div>
        )}
      </SectionCard>

      <SectionCard title="Scheduled jobs" subtitle={`All ${data.crons.length} crons · click a row for its recent run history`}>
        <div className="space-y-2">{data.crons.map((c) => <CronCard key={c.jobName} c={c} />)}</div>
      </SectionCard>
    </div>
  );
}
