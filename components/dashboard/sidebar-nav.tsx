"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  TrendingUp,
  LayoutDashboard,
  DollarSign,
  ArrowLeftRight,
  Users,
  Brain,
  Plug,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "War Room", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/revenue", label: "Revenue", icon: TrendingUp },
  { href: "/dashboard/cashflow", label: "Cash Flow", icon: ArrowLeftRight },
  { href: "/dashboard/collections", label: "Collections", icon: DollarSign },
  { href: "/dashboard/intelligence", label: "AI Intelligence", icon: Brain },
  { href: "/dashboard/connectors", label: "Connectors", icon: Plug },
];

interface SidebarNavProps {
  org: { id: string; name: string };
  userEmail: string;
}

export function SidebarNav({ org, userEmail }: SidebarNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
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
    <aside
      className={cn(
        "relative flex flex-col bg-[#060a14] border-r border-white/[0.05] transition-all duration-300 ease-out",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Ambient top glow */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-primary/[0.06] to-transparent" />

      {/* Logo */}
      <div
        className={cn(
          "relative flex items-center gap-2.5 px-4 h-16 border-b border-white/[0.05]",
          collapsed && "justify-center px-0"
        )}
      >
        <div className="relative w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_hsl(258_88%_66%/0.3)]">
          <TrendingUp className="w-4 h-4 text-primary" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <p className="font-semibold text-sm leading-none text-white/90 tracking-tight">Finance OS</p>
            <p className="text-[11px] text-white/30 truncate max-w-[130px] mt-0.5">{org.name}</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2.5 space-y-0.5 relative">
        {navItems.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                active
                  ? "bg-primary/[0.12] text-white/90"
                  : "text-white/35 hover:bg-white/[0.04] hover:text-white/70",
                collapsed && "justify-center px-0"
              )}
              title={collapsed ? item.label : undefined}
            >
              {/* Active left bar */}
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-primary shadow-[0_0_8px_hsl(258_88%_66%/0.6)]" />
              )}
              <item.icon
                className={cn(
                  "w-4 h-4 flex-shrink-0 transition-colors duration-150",
                  active ? "text-primary" : "text-white/35 group-hover:text-white/60"
                )}
              />
              {!collapsed && <span>{item.label}</span>}
              {/* Active dot */}
              {active && !collapsed && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_hsl(258_88%_66%/0.8)]" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2.5 border-t border-white/[0.05]">
        <div
          className={cn(
            "flex items-center gap-2.5 px-3 py-2 mb-1 rounded-lg",
            collapsed && "justify-center px-0"
          )}
        >
          <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-semibold text-primary">
              {userEmail.charAt(0).toUpperCase()}
            </span>
          </div>
          {!collapsed && (
            <p className="text-xs text-white/30 truncate">{userEmail}</p>
          )}
        </div>
        <button
          onClick={handleSignOut}
          className={cn(
            "flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-white/25 hover:bg-red-500/[0.08] hover:text-red-400 transition-all duration-150",
            collapsed && "justify-center px-0"
          )}
          title={collapsed ? "Sign out" : undefined}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-[#0c1221] border border-white/[0.08] flex items-center justify-center hover:border-primary/40 hover:bg-primary/10 transition-all duration-150 z-10 shadow-md"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-white/40" />
        ) : (
          <ChevronLeft className="w-3 h-3 text-white/40" />
        )}
      </button>
    </aside>
  );
}
