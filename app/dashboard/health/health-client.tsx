"use client";

import { useState } from "react";
import { RefreshCw, ChevronRight, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { SectionCard } from "@/components/dashboard/section-card";
import { cn, formatDateRelative } from "@/lib/utils";
import type { SyncHealthData, ConnectorHealth, CronHealth, SyncJobLite } from "@/lib/ops/health";

const DOT: Record<"green" | "amber" | "red", string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-rose-500",
};
const rel = (iso: string | null) => (iso ? formatDateRelative(iso) : "never");

function HealthDot({ level }: { level: "green" | "amber" | "red" }) {
  return <span className={cn("inline-block w-2.5 h-2.5 rounded-full flex-shrink-0", DOT[level])} />;
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
    <div className={cn("rounded-xl border bg-card", c.health === "red" ? "border-rose-500/30" : "border-border")}>
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
        {c.reason && (
          <span className={cn("text-[11px] flex-shrink-0", c.health === "red" ? "text-rose-600" : "text-amber-600")}>{c.reason}</span>
        )}
      </button>
      {open && hasJobs && (
        <div className="bg-muted/20 rounded-b-xl">
          {c.jobs.map((j) => <JobRow key={j.id} j={j} />)}
        </div>
      )}
    </div>
  );
}

function CronRow({ c }: { c: CronHealth }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-0">
      <HealthDot level={c.health} />
      <span className="text-[12.5px] font-medium text-foreground w-40 flex-shrink-0">{c.jobName}</span>
      <span className={cn("text-[11.5px] w-16 flex-shrink-0", c.lastStatus === "failed" ? "text-rose-600" : c.lastStatus === "ok" ? "text-emerald-600" : "text-muted-foreground")}>
        {c.lastStatus === "none" ? "no runs" : c.lastStatus}
      </span>
      <span className="text-[11px] text-muted-foreground flex-1 truncate">
        {c.lastRunAt ? `ran ${rel(c.lastRunAt)}` : "—"}
        {c.lastDurationMs != null ? ` · ${(c.lastDurationMs / 1000).toFixed(1)}s` : ""}
      </span>
      {c.lastError && <span className="text-[11px] text-rose-600/90 flex-shrink-0 max-w-[40%] truncate" title={c.lastError}>{c.lastError}</span>}
    </div>
  );
}

export function HealthClient({ data }: { data: SyncHealthData }) {
  const allGreen = data.redFlags.length === 0 && data.connectors.every((c) => c.health === "green");
  return (
    <div className="space-y-5">
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

      {data.redFlags.length > 0 ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2 text-rose-600">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-[13px] font-semibold">{data.redFlags.length} issue{data.redFlags.length === 1 ? "" : "s"} need attention</span>
          </div>
          <ul className="space-y-1 text-[12px] text-foreground/90">
            {data.redFlags.map((f, i) => <li key={i} className="flex gap-2"><span className="text-rose-500">•</span>{f}</li>)}
          </ul>
        </div>
      ) : allGreen ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-4 flex items-center gap-2 text-emerald-600">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-[13px] font-medium">Everything is syncing normally.</span>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-4 flex items-center gap-2 text-amber-600">
          <Clock className="w-4 h-4" />
          <span className="text-[13px] font-medium">Some connectors are stale or retrying — see below.</span>
        </div>
      )}

      <SectionCard title="Connectors" subtitle={`${data.connectors.length} connector${data.connectors.length === 1 ? "" : "s"} · click a row for its recent sync runs`}>
        {data.connectors.length === 0 ? (
          <p className="p-4 text-center text-[12px] text-muted-foreground">No connectors yet.</p>
        ) : (
          <div className="space-y-2">{data.connectors.map((c) => <ConnectorCard key={c.id} c={c} />)}</div>
        )}
      </SectionCard>

      <SectionCard title="Scheduled jobs" subtitle="Nightly reconcile, rollup rebuild, FX correction and sheet sync">
        <div className="rounded-xl border border-border overflow-hidden">
          {data.crons.map((c) => <CronRow key={c.jobName} c={c} />)}
        </div>
      </SectionCard>
    </div>
  );
}
