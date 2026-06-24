"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCw, X, ArrowRight, Database } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
];

function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10);
}

interface SyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onSyncComplete?: () => void;
}

/**
 * Global "Sync Data" — NON-BLOCKING. Picks a date range, fires off a background
 * sync for all connected sources, then closes immediately. Progress shows as the
 * filling bars on Connectors + the spinner in the top bar; the dashboard stays
 * fully usable (no blocking overlay, no inline wait, can't time out).
 */
export function SyncModal({ open, onOpenChange, orgId }: SyncModalProps) {
  const today = new Date();
  const [toDate, setToDate] = React.useState(toDateInputValue(today));
  const [fromDate, setFromDate] = React.useState(
    toDateInputValue(new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000))
  );
  const [activePreset, setActivePreset] = React.useState<number>(30);
  const [submitting, setSubmitting] = React.useState(false);

  function applyPreset(days: number) {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    setToDate(toDateInputValue(to));
    setFromDate(toDateInputValue(from));
    setActivePreset(days);
  }

  async function handleSync() {
    const isoRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoRe.test(fromDate) || !isoRe.test(toDate)) {
      toast.error("Pick a valid From and To date.");
      return;
    }
    if (fromDate > toDate) {
      toast.error('"From" date must be before "To" date.');
      return;
    }

    setSubmitting(true);
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
      const data = await res.json() as { connectors?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Sync failed");

      const n = data.connectors ?? 0;
      toast.success(
        n > 0
          ? `Sync started for ${n} source${n > 1 ? "s" : ""} — running in the background. Watch progress on Connectors.`
          : "No connected sources to sync yet."
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSubmitting(false);
    }
  }

  const daysDiff = Math.round(
    (new Date(toDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24)
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md animate-fade-in" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-popover border border-border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.7)] focus:outline-none animate-scale-in">

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
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest mb-3">Date Range</p>

              <div className="flex gap-1.5 mb-3">
                {PRESETS.map((p) => (
                  <button
                    key={p.days}
                    onClick={() => applyPreset(p.days)}
                    className={cn(
                      "flex-1 h-7 rounded-lg text-xs font-medium transition-all duration-150",
                      activePreset === p.days
                        ? "bg-primary/15 border border-primary/30 text-primary"
                        : "bg-accent/40 border border-border text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-muted-foreground/70 block mb-1">From</label>
                  <input
                    type="date"
                    value={fromDate}
                    max={toDate}
                    onChange={(e) => { setFromDate(e.target.value); setActivePreset(0); }}
                    className="w-full h-9 rounded-lg border border-border bg-accent/40 px-3 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25 [color-scheme:dark]"
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
                    onChange={(e) => { setToDate(e.target.value); setActivePreset(0); }}
                    className="w-full h-9 rounded-lg border border-border bg-accent/40 px-3 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25 [color-scheme:dark]"
                  />
                </div>
              </div>

              {daysDiff > 0 && (
                <p className="text-[11px] text-muted-foreground/70 mt-2">
                  Pulling <span className="text-muted-foreground font-medium">{daysDiff} days</span> of data — runs in the background.
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-2.5 px-6 pb-5">
            <Dialog.Close asChild>
              <Button variant="outline" className="flex-1 border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border">
                Cancel
              </Button>
            </Dialog.Close>
            <Button className="flex-1 shadow-[0_0_16px_hsl(258_88%_66%/0.2)]" onClick={handleSync} disabled={submitting || !fromDate || !toDate}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", submitting && "animate-spin")} />
              {submitting ? "Starting…" : "Start Sync"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
