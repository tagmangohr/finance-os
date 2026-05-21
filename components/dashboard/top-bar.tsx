"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw, Bell } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const PAGE_TITLES: Record<string, { title: string; emoji: string }> = {
  "/dashboard": { title: "War Room", emoji: "⚡" },
  "/dashboard/revenue": { title: "Revenue", emoji: "📈" },
  "/dashboard/cashflow": { title: "Cash Flow", emoji: "💧" },
  "/dashboard/collections": { title: "Collections", emoji: "📬" },
  "/dashboard/intelligence": { title: "AI Intelligence", emoji: "🧠" },
  "/dashboard/connectors": { title: "Connectors", emoji: "🔌" },
};

interface TopBarProps {
  orgId: string;
  orgName: string;
}

export function TopBar({ orgId, orgName }: TopBarProps) {
  const pathname = usePathname();
  const [syncing, setSyncing] = useState(false);
  const page = PAGE_TITLES[pathname] ?? { title: "Finance OS", emoji: "✦" };

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
    <header className="sticky top-0 z-10 h-14 flex items-center justify-between px-6 border-b border-white/[0.05] bg-[#060a14]/80 backdrop-blur-xl">
      <div className="flex items-center gap-2.5">
        <span className="text-base leading-none">{page.emoji}</span>
        <div>
          <h1 className="font-semibold text-sm text-white/90 leading-none">{page.title}</h1>
          <p className="text-[11px] text-white/25 mt-0.5">{orgName}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className={cn(
            "flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium transition-all duration-150 disabled:opacity-40",
            "border border-white/[0.08] bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/75 hover:border-white/[0.12]"
          )}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Sync"}
        </button>
        <button className="relative w-8 h-8 rounded-lg border border-white/[0.08] bg-white/[0.03] flex items-center justify-center hover:bg-white/[0.06] hover:border-white/[0.12] transition-all duration-150 text-white/40 hover:text-white/70">
          <Bell className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}
