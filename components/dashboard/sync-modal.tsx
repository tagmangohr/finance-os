"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RefreshCw, X, Database } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn, fyStartISO } from "@/lib/utils";
import { DateRangePicker } from "@/components/ui/date-range-picker";

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
  // Default to the start of the current financial year (1 Apr) so a sync reconciles
  // the whole FY — catching refunds/disputes/status changes on older orders, not
  // just recent ones. The picker still allows any custom range.
  const [fromDate, setFromDate] = React.useState(fyStartISO(today));
  const [submitting, setSubmitting] = React.useState(false);

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
          ? `Syncing ${n} source${n > 1 ? "s" : ""} in the background — you can keep working. Progress shows on Connectors.`
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
              <DateRangePicker
                from={fromDate}
                to={toDate}
                max={toDateInputValue(new Date())}
                onChange={(f, t) => { setFromDate(f); setToDate(t); }}
                className="w-full justify-start"
              />
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
