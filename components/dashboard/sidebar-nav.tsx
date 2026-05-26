"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  TrendingUp, LayoutDashboard, DollarSign, ArrowLeftRight,
  Brain, Plug, Table2, LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard",              label: "War Room",     Icon: LayoutDashboard, exact: true,  hint: "⌘1" },
  { href: "/dashboard/revenue",      label: "Revenue",      Icon: TrendingUp,      exact: false, hint: "⌘2" },
  { href: "/dashboard/cashflow",     label: "Cash Flow",    Icon: ArrowLeftRight,  exact: false, hint: "⌘3" },
  { href: "/dashboard/collections",  label: "Collections",  Icon: DollarSign,      exact: false, hint: "⌘4" },
  { href: "/dashboard/intelligence", label: "Intelligence", Icon: Brain,           exact: false, hint: "⌘5" },
  { href: "/dashboard/connectors",   label: "Connectors",   Icon: Plug,            exact: false, hint: "⌘6" },
  { href: "/dashboard/data",         label: "Raw Data",     Icon: Table2,          exact: false, hint: "⌘7" },
];

interface SidebarNavProps {
  org: { id: string; name: string };
  userEmail: string;
  connectorCount?: number;
  liveCount?: number;
  lastSyncedAt?: string | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function SidebarNav({
  org,
  userEmail,
  connectorCount = 0,
  liveCount = 0,
  lastSyncedAt,
}: SidebarNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <aside className="relative flex flex-col w-56 bg-[rgba(4,7,15,0.7)] border-r border-white/[0.06] z-[1]">
      {/* Ambient top gradient */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-28 bg-gradient-to-b from-primary/[0.06] to-transparent" />

      {/* Logo */}
      <div className="relative flex items-center gap-2.5 px-4 pt-4 pb-4 border-b border-white/[0.06]">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: "linear-gradient(135deg, rgba(124,82,240,0.4), rgba(124,82,240,0.15))",
            border: "1px solid rgba(124,82,240,0.4)",
            boxShadow: "0 0 14px rgba(124,82,240,0.35), inset 0 0 12px rgba(124,82,240,0.18)",
          }}
        >
          <TrendingUp className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="overflow-hidden">
          <p className="font-semibold text-[13px] leading-none text-white/90 tracking-tight">Finance OS</p>
          <p className="text-[10px] text-white/30 truncate mt-0.5">{org.name}</p>
        </div>
      </div>

      {/* Nav section label */}
      <div className="px-3 pt-3 pb-1">
        <span className="text-[9.5px] font-bold tracking-[0.16em] text-white/20 uppercase">Workspace</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2.5 space-y-px">
        {navItems.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12.5px] font-medium transition-all duration-150",
                active
                  ? "bg-primary/[0.12] text-white"
                  : "text-white/35 hover:bg-white/[0.03] hover:text-white/70"
              )}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-[2px] bg-primary"
                  style={{ boxShadow: "0 0 8px rgba(124,82,240,0.6)" }}
                />
              )}
              <item.Icon
                className={cn(
                  "w-[15px] h-[15px] flex-shrink-0 transition-colors duration-150",
                  active ? "text-primary" : "text-white/35 group-hover:text-white/60"
                )}
              />
              <span className="flex-1">{item.label}</span>
              <span className={cn(
                "text-[9.5px] font-mono flex-shrink-0",
                active ? "text-primary/50" : "text-white/15 group-hover:text-white/25"
              )}>
                {item.hint}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Status section */}
      {connectorCount > 0 && (
        <div className="mx-2.5 mt-3 mb-2 p-2 border border-white/[0.06] rounded-lg bg-white/[0.015]">
          <div className="text-[9.5px] font-bold tracking-[0.14em] text-white/20 uppercase mb-2">Status</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[11px] text-white/45">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"
                style={{ boxShadow: "0 0 6px rgba(29,184,132,0.6)" }} />
              <span className="flex-1">{connectorCount} connector{connectorCount !== 1 ? "s" : ""}</span>
              <span className="text-white/25 font-mono text-[10px]">{liveCount} live</span>
            </div>
            {lastSyncedAt && (
              <div className="flex items-center gap-2 text-[11px] text-white/45">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="flex-1">Last sync</span>
                <span className="text-white/25 font-mono text-[10px]">{timeAgo(lastSyncedAt)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="p-2.5 border-t border-white/[0.06]">
        <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
          <div
            className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #2a3a6f, #0f1628)" }}
          >
            {userEmail.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-white/70 truncate">{userEmail.split("@")[0]}</p>
            <p className="text-[10px] text-white/25 truncate">{userEmail}</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[12px] text-white/25 hover:bg-red-500/[0.08] hover:text-red-400 transition-all duration-150"
        >
          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
