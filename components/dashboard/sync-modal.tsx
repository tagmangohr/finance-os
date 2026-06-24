"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ArrowRight,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SyncResult } from "@/app/api/sync/route";

// ─── Date range presets ───────────────────────────────────────────────────────

const PRESETS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
];

function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ResultRow({ r }: { r: SyncResult }) {
  const [open, setOpen] = React.useState(false);
  const hasError = !!r.error;
  const hasChanges = r.inserted > 0 || r.updated > 0;

  return (
    <div className={cn(
      "rounded-xl border transition-all duration-150",
      hasError ? "border-red-500/20 bg-red-500/[0.04]" : "border-border bg-accent/40"
    )}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {hasError ? (
          <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-success flex-shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground capitalize">{r.connector_name}</span>
            <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/40">
              {r.type}
            </span>
            {r.warnings && r.warnings.length > 0 && !hasError && (
              <span className="text-[10px] text-warning/70 uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/[0.08] border border-amber-400/20">
                {r.warnings.length} skipped
              </span>
            )}
          </div>
          {!hasError && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              <span className={cn("font-semibold", hasChanges ? "text-success" : "text-muted-foreground")}>
                {r.inserted} new
              </span>
              {r.updated > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-violet-400">{r.updated} refreshed</span>
                </>
              )}
              {" · "}
              {r.fetched} fetched
              {r.skipped > 0 && ` · ${r.skipped} already existed`}
            </p>
          )}
          {hasError && (
            <p className="text-xs text-destructive/70 mt-0.5 truncate">{r.error}</p>
          )}
        </div>

        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground/70 transition-transform duration-150 flex-shrink-0",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="px-4 pb-3 pt-0 border-t border-border">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 mt-3">
            <DetailRow label="Fetched from API" value={String(r.fetched)} />
            <DetailRow label="New inserted" value={String(r.inserted)} highlight={r.inserted > 0} />
            <DetailRow label="Refreshed" value={String(r.updated)} highlight={r.updated > 0} />
            <DetailRow label="Already existed" value={String(r.skipped)} />
            <DetailRow
              label="Date range"
              value={`${new Date(r.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} → ${new Date(r.to).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`}
            />
          </div>
          {r.warnings && r.warnings.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-semibold text-warning/50 uppercase tracking-widest">Unavailable endpoints</p>
              {r.warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-warning/50 leading-relaxed">{w}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground/70">{label}</span>
      <span className={cn("text-[11px] font-semibold", highlight ? "text-success" : "text-muted-foreground")}>
        {value}
      </span>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

interface SyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onSyncComplete?: () => void;
}

type SyncState = "idle" | "syncing" | "done" | "error";

interface SyncResponse {
  results: SyncResult[];
  total_fetched: number;
  total_inserted: number;
  total_updated: number;
  total_skipped: number;
  from: string;
  to: string;
  error?: string;
}

export function SyncModal({ open, onOpenChange, orgId, onSyncComplete }: SyncModalProps) {
  const today = new Date();
  const [toDate, setToDate] = React.useState(toDateInputValue(today));
  const [fromDate, setFromDate] = React.useState(
    toDateInputValue(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000))
  );
  const [activePreset, setActivePreset] = React.useState<number>(30);
  const [state, setState] = React.useState<SyncState>("idle");
  const [response, setResponse] = React.useState<SyncResponse | null>(null);

  function applyPreset(days: number) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    setToDate(toDateInputValue(to));
    setFromDate(toDateInputValue(from));
    setActivePreset(days);
  }

  function handleFromChange(v: string) {
    setFromDate(v);
    setActivePreset(0); // custom
  }

  function handleToChange(v: string) {
    setToDate(v);
    setActivePreset(0); // custom
  }

  async function handleSync() {
    // Guard: dates must be valid ISO (YYYY-MM-DD). Build the range as ISO strings
    // directly — never `new Date(str).toISOString()`, which throws "string did not
    // match the expected pattern" on an empty/locale-formatted value.
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoRe.test(fromDate) || !isoRe.test(toDate)) {
      setResponse({ results: [], total_fetched: 0, total_inserted: 0, total_updated: 0, total_skipped: 0, from: fromDate, to: toDate, error: "Pick a valid From and To date." });
      setState("error");
      return;
    }

    setState("syncing");
    setResponse(null);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          from_date: `${fromDate}T00:00:00.000Z`,
          to_date: `${toDate}T23:59:59.999Z`,
        }),
      });

      const data: SyncResponse = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");

      setResponse(data);
      setState("done");
      if (data.total_inserted > 0 || data.total_updated > 0) onSyncComplete?.();
    } catch (err) {
      setResponse({ results: [], total_fetched: 0, total_inserted: 0, total_updated: 0, total_skipped: 0, from: fromDate, to: toDate, error: err instanceof Error ? err.message : "Unknown error" });
      setState("error");
    }
  }

  function handleClose() {
    if (state === "done" && response && (response.total_inserted > 0 || response.total_updated > 0)) {
      window.location.reload();
    }
    onOpenChange(false);
    // Reset for next open
    setTimeout(() => { setState("idle"); setResponse(null); }, 300);
  }

  const daysDiff = Math.round(
    (new Date(toDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md animate-fade-in" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-popover border border-border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.7)] focus:outline-none animate-scale-in">

          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center">
                <Database className="h-4 w-4 text-primary" />
              </div>
              <div>
                <Dialog.Title className="text-sm font-semibold text-foreground">Sync Data</Dialog.Title>
                <p className="text-[11px] text-muted-foreground/70">Pull transactions from connected sources</p>
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="text-muted-foreground/70 hover:text-muted-foreground transition-colors rounded-lg p-1.5 hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-6 py-5 space-y-5">

            {/* Date range section */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest mb-3">Date Range</p>

              {/* Presets */}
              <div className="flex gap-1.5 mb-3">
                {PRESETS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => applyPreset(p.days)}
                    disabled={state === "syncing"}
                    className={cn(
                      "flex-1 h-7 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-40",
                      activePreset === p.days
                        ? "bg-primary/15 border border-primary/30 text-primary"
                        : "bg-accent/40 border border-border text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  onClick={() => setActivePreset(0)}
                  disabled={state === "syncing"}
                  className={cn(
                    "flex-1 h-7 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-40",
                    activePreset === 0
                      ? "bg-primary/15 border border-primary/30 text-primary"
                      : "bg-accent/40 border border-border text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent"
                  )}
                >
                  Custom
                </button>
              </div>

              {/* Date inputs */}
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground/70 block mb-1">From</label>
                  <input
                    type="date"
                    value={fromDate}
                    max={toDate}
                    onChange={(e) => handleFromChange(e.target.value)}
                    disabled={state === "syncing"}
                    className="w-full h-9 rounded-lg border border-border bg-accent/40 px-3 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25 disabled:opacity-40 [color-scheme:dark]"
                  />
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/70 flex-shrink-0 mt-4" />
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground/70 block mb-1">To</label>
                  <input
                    type="date"
                    value={toDate}
                    min={fromDate}
                    max={toDateInputValue(new Date())}
                    onChange={(e) => handleToChange(e.target.value)}
                    disabled={state === "syncing"}
                    className="w-full h-9 rounded-lg border border-border bg-accent/40 px-3 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25 disabled:opacity-40 [color-scheme:dark]"
                  />
                </div>
              </div>

              {daysDiff > 0 && (
                <p className="text-[11px] text-muted-foreground/70 mt-2">
                  Pulling <span className="text-muted-foreground font-medium">{daysDiff} days</span> of data
                  {daysDiff > 90 && (
                    <span className="text-warning/60 ml-2">· may take a moment for large datasets</span>
                  )}
                </p>
              )}
            </div>

            {/* Results */}
            {state !== "idle" && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest mb-3">Results</p>

                {state === "syncing" && (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-accent/40 px-4 py-4">
                    <RefreshCw className="h-4 w-4 text-primary animate-spin flex-shrink-0" />
                    <div>
                      <p className="text-sm text-muted-foreground font-medium">Syncing…</p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">Fetching from all connected sources</p>
                    </div>
                  </div>
                )}

                {(state === "done" || state === "error") && response && (
                  <div className="space-y-2">
                    {/* Error (no connectors / network error) */}
                    {response.error && (
                      <div className="flex items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3">
                        <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                        <p className="text-sm text-destructive/80">{response.error}</p>
                      </div>
                    )}

                    {/* No connectors */}
                    {!response.error && response.results.length === 0 && (
                      <div className="rounded-xl border border-border bg-accent/40 px-4 py-4 text-center">
                        <p className="text-sm text-muted-foreground/70">No active connectors found.</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">Connect Razorpay or Stripe first.</p>
                      </div>
                    )}

                    {/* Per-connector rows */}
                    {response.results.map((r) => (
                      <ResultRow key={r.connector_id} r={r} />
                    ))}

                    {/* Summary */}
                    {response.results.length > 0 && (
                      <div className="flex items-center justify-between rounded-xl bg-accent/40 border border-border px-4 py-3 mt-1">
                        <span className="text-xs text-muted-foreground/70">Total</span>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-muted-foreground/70">{response.total_fetched} fetched</span>
                          <span className={cn("font-semibold", response.total_inserted > 0 ? "text-success" : "text-muted-foreground")}>
                            {response.total_inserted} new
                          </span>
                          {response.total_updated > 0 && (
                            <span className="font-semibold text-violet-400">{response.total_updated} refreshed</span>
                          )}
                          {response.total_skipped > 0 && (
                            <span className="text-muted-foreground/70">{response.total_skipped} skipped</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-2.5 px-6 pb-5">
            <Dialog.Close asChild>
              <Button
                variant="outline"
                className="flex-1 border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border"
              >
                {state === "done" ? "Close" : "Cancel"}
              </Button>
            </Dialog.Close>
            {state !== "done" && (
              <Button
                className="flex-1 shadow-[0_0_16px_hsl(258_88%_66%/0.2)]"
                onClick={handleSync}
                disabled={state === "syncing" || !fromDate || !toDate}
              >
                {state === "syncing" ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-2" />
                    Start Sync
                  </>
                )}
              </Button>
            )}
            {state === "done" && response && (response.total_inserted > 0 || response.total_updated > 0) && (
              <Button className="flex-1" onClick={handleClose}>
                Reload dashboard
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
