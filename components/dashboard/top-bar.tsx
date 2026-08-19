"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw, Bell, Search } from "lucide-react";
import { SyncModal } from "@/components/dashboard/sync-modal";
import { CommandPalette, useCommandPalette } from "@/components/dashboard/command-palette";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { cn } from "@/lib/utils";

const PAGE_META: Record<string, { label: string }> = {
  "/dashboard":              { label: "War Room" },
  "/dashboard/revenue":      { label: "Revenue" },
  "/dashboard/cashflow":     { label: "Cash Flow" },
  "/dashboard/subscriptions": { label: "Subscriptions" },
  "/dashboard/connectors":   { label: "Connectors" },
  "/dashboard/data":         { label: "Payments" },
  "/dashboard/bank":         { label: "Bank" },
  "/dashboard/profile":      { label: "Profile" },
  "/dashboard/users":        { label: "Team" },
};

interface TopBarProps {
  orgId: string;
  orgName: string;
}

export function TopBar({ orgId, orgName }: TopBarProps) {
  const pathname = usePathname();
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncActive, setSyncActive] = useState(false);
  const [clock, setClock] = useState("");
  const { open: cmdOpen, setOpen: setCmdOpen, close: closeCmd } = useCommandPalette();

  // Global sync indicator: poll org-wide job progress so the top bar spins on any
  // page while a background sync runs (non-blocking — the dashboard stays usable).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async () => {
      let active = false;
      try {
        const res = await fetch(`/api/connectors/jobs?org_id=${orgId}`);
        if (res.ok) {
          const data = await res.json() as { connectors?: Record<string, { active: boolean }> };
          active = Object.values(data.connectors ?? {}).some((p) => p.active);
        }
      } catch { /* keep last state */ }
      if (!cancelled) { setSyncActive(active); timer = setTimeout(tick, active ? 3000 : 10000); }
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orgId]);

  const page = PAGE_META[pathname] ?? { label: "Finance OS" };

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setClock(
        now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) +
        " IST · " +
        now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
      );
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <header
        className="sticky top-0 z-[5] h-12 flex items-center gap-3 px-4 border-b border-border flex-shrink-0 bg-background/75 backdrop-blur-xl"
      >
        {/* Left: breadcrumb + LIVE pill + clock */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="text-muted-foreground">{orgName}</span>
            <span className="text-muted-foreground/60">/</span>
            <span className="font-semibold text-foreground">{page.label}</span>
          </div>

          <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10.5px] font-semibold border bg-success/10 text-success border-success/25">
            <span className="w-1 h-1 rounded-full bg-success" />
            LIVE
          </span>

          {clock && (
            <span className="num text-[11px] text-muted-foreground/80 hidden md:block">{clock}</span>
          )}
        </div>

        {/* Right: ⌘K search + theme + refresh + bell */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-2 h-[30px] w-[260px] px-2.5 rounded-lg text-[12px] text-muted-foreground cursor-pointer transition-colors bg-accent/60 border border-border hover:border-border/80"
          >
            <Search className="h-3 w-3 flex-shrink-0" />
            <span className="flex-1 text-left">Ask anything or jump to…</span>
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded text-muted-foreground bg-background border border-border">⌘K</kbd>
          </button>

          <ThemeToggle />

          <button
            onClick={() => setSyncOpen(true)}
            aria-label={syncActive ? "Syncing…" : "Sync"}
            title={syncActive ? "Syncing in the background…" : "Sync data"}
            className="relative w-[30px] h-[30px] rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", syncActive && "animate-spin text-primary")} />
            {syncActive && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            )}
          </button>

          <button aria-label="Notifications" className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <Bell className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <SyncModal open={syncOpen} onOpenChange={setSyncOpen} orgId={orgId} onSyncComplete={() => {}} />
      <CommandPalette open={cmdOpen} onClose={closeCmd} />
    </>
  );
}
