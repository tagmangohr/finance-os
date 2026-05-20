"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw, Bell } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "War Room",
  "/dashboard/revenue": "Revenue",
  "/dashboard/cashflow": "Cash Flow",
  "/dashboard/collections": "Collections",
  "/dashboard/intelligence": "AI Intelligence",
  "/dashboard/connectors": "Connectors",
};

interface TopBarProps {
  orgId: string;
  orgName: string;
}

export function TopBar({ orgId, orgName }: TopBarProps) {
  const pathname = usePathname();
  const [syncing, setSyncing] = useState(false);
  const title = PAGE_TITLES[pathname] ?? "Finance OS";

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.results?.length === 0) {
        toast.info("No active connectors to sync. Set up a connector first.");
      } else {
        toast.success(`Synced ${data.total_synced} transactions`);
        window.location.reload();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-card">
      <div>
        <h1 className="font-semibold text-lg">{title}</h1>
        <p className="text-xs text-muted-foreground">{orgName}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className={cn(
            "flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium border border-border bg-background hover:bg-accent transition-colors disabled:opacity-50",
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync All"}
        </button>
        <button className="w-9 h-9 rounded-lg border border-border bg-background flex items-center justify-center hover:bg-accent transition-colors">
          <Bell className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
