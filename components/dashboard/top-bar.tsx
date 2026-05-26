"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw, Bell, Search } from "lucide-react";
import { SyncModal } from "@/components/dashboard/sync-modal";
import { CommandPalette, useCommandPalette } from "@/components/dashboard/command-palette";

const PAGE_META: Record<string, { label: string }> = {
  "/dashboard":              { label: "War Room" },
  "/dashboard/revenue":      { label: "Revenue" },
  "/dashboard/cashflow":     { label: "Cash Flow" },
  "/dashboard/collections":  { label: "Collections" },
  "/dashboard/intelligence": { label: "Intelligence" },
  "/dashboard/connectors":   { label: "Connectors" },
  "/dashboard/data":         { label: "Raw Data" },
};

interface TopBarProps {
  orgId: string;
  orgName: string;
}

export function TopBar({ orgId, orgName }: TopBarProps) {
  const pathname = usePathname();
  const [syncOpen, setSyncOpen] = useState(false);
  const [clock, setClock] = useState("");
  const { open: cmdOpen, setOpen: setCmdOpen, close: closeCmd } = useCommandPalette();

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
        className="sticky top-0 z-[5] h-12 flex items-center gap-3 px-4 border-b border-white/[0.06] flex-shrink-0"
        style={{ background: "rgba(4,7,15,0.75)", backdropFilter: "blur(20px)" }}
      >
        {/* Left: breadcrumb + LIVE pill + clock */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="text-white/30">{orgName}</span>
            <span className="text-white/20">/</span>
            <span className="font-semibold text-white/85">{page.label}</span>
          </div>

          <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[10.5px] font-semibold border bg-emerald-500/10 text-emerald-400 border-emerald-500/25">
            <span className="w-1 h-1 rounded-full bg-emerald-400" />
            LIVE
          </span>

          {clock && (
            <span className="num text-[11px] text-white/25 hidden md:block">{clock}</span>
          )}
        </div>

        {/* Right: ⌘K search + refresh + bell */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-2 h-[30px] w-[260px] px-2.5 rounded-lg text-[12px] cursor-pointer transition-all"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.10)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
          >
            <Search className="h-3 w-3 flex-shrink-0" />
            <span className="flex-1 text-left">Ask anything or jump to…</span>
            <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded text-white/30"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>⌘K</kbd>
          </button>

          <button
            onClick={() => setSyncOpen(true)}
            className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-white/35 hover:text-white/70 hover:bg-white/[0.04] transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-white/35 hover:text-white/70 hover:bg-white/[0.04] transition-all">
            <Bell className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <SyncModal open={syncOpen} onOpenChange={setSyncOpen} orgId={orgId} onSyncComplete={() => {}} />
      <CommandPalette open={cmdOpen} onClose={closeCmd} />
    </>
  );
}
