"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  TrendingUp, LayoutDashboard, Plug, Table2, Landmark, LogOut, User, Users,
  Repeat, Activity, Sheet, LineChart, Scale, Settings, BarChart3, ShoppingBag,
  PanelLeftClose, PanelLeftOpen, type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { OrgSwitcher, type SwitcherOrg } from "@/components/dashboard/org-switcher";
import { UserAvatar } from "@/components/ui/user-avatar";

// ─── Nav definitions ──────────────────────────────────────────────────────────
// One intent-grouped navigation (the old top tab bar is folded in here): the user
// navigates by WHAT they're doing — Overview, Money in, Money out — with Setup
// pinned last. `slug` drives page-access gating; items without a slug are always
// shown (subject to ownerOnly). This mirrors the app's revenue/expense firewall.

type NavItem = { href: string; slug?: string; label: string; Icon: LucideIcon; exact?: boolean; ownerOnly?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [
    { href: "/dashboard",              slug: "dashboard",    label: "Dashboard",     Icon: LayoutDashboard, exact: true },
    { href: "/dashboard/analytics",    slug: "analytics",    label: "Analytics",     Icon: BarChart3 },
    { href: "/dashboard/pnl",          slug: "pnl",          label: "Profit & Loss", Icon: Sheet },
    { href: "/dashboard/forecast",     slug: "forecast",     label: "Forecast",      Icon: LineChart },
    { href: "/dashboard/variance",     slug: "variance",     label: "Variance",      Icon: Scale },
  ]},
  { label: "Money in", items: [
    { href: "/dashboard/data",          slug: "data",          label: "Payments",      Icon: Table2 },
    { href: "/dashboard/revenue",       slug: "revenue",       label: "Revenue",       Icon: TrendingUp },
    // "sales" is a grantable (PII) slug — visible to owners/admins and members granted it.
    { href: "/dashboard/sales",         slug: "sales",         label: "Sales",         Icon: ShoppingBag },
    { href: "/dashboard/subscriptions", slug: "subscriptions", label: "Subscriptions", Icon: Repeat },
  ]},
  { label: "Money out", items: [
    // "bank" is a grantable (PII) slug now — visible to owners/admins and members granted it.
    { href: "/dashboard/bank",     slug: "bank",     label: "Bank",      Icon: Landmark },
    // Cash flow hidden from nav per request (2026-09-16) — route/page kept, just not linked.
  ]},
];

const SETUP_NAV: NavItem[] = [
  { href: "/dashboard/connectors", slug: "connectors", label: "Connectors", Icon: Plug },
  { href: "/dashboard/health",     slug: "health",     label: "Sync Health", Icon: Activity },
  { href: "/dashboard/profile",    label: "Profile",   Icon: User },
  { href: "/dashboard/users",      label: "Team",      Icon: Users, ownerOnly: true },
  { href: "/dashboard/settings",   label: "Settings",  Icon: Settings, ownerOnly: true },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SidebarNavProps {
  org:            { id: string; name: string };
  accessibleOrgs?: SwitcherOrg[];
  canCreateOrg?:  boolean;
  userEmail:      string;
  userName?:      string;
  userAvatarUrl?: string | null;
  /** null = owner/admin (all pages visible); string[] = specific slugs allowed */
  pageAccess?:    string[] | null;
  canManageTeam?: boolean;
  connectorCount?: number;
  liveCount?:      number;
  lastSyncedAt?:   string | null;
  /** Initial collapsed state (read from cookie server-side to avoid a flash). */
  defaultCollapsed?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SidebarNav({
  org,
  accessibleOrgs = [],
  canCreateOrg   = false,
  userEmail,
  userName,
  userAvatarUrl = null,
  pageAccess   = null,
  canManageTeam = true,
  connectorCount = 0,
  liveCount      = 0,
  lastSyncedAt,
  defaultCollapsed = false,
}: SidebarNavProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

  // One-click collapse to an icon rail. Persisted in a cookie (read server-side in the
  // layout) so it survives reloads and paints correctly on first render.
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { document.cookie = `fos-sidebar-collapsed=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`; } catch { /* ignore */ }
      return next;
    });
  };

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/auth/login");
    router.refresh();
  }

  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  // An item is visible if: it has no access slug (always), OR access is unrestricted
  // (owner/admin), OR the slug is in the member's allowed set. Team is ownerOnly.
  const canSee = (item: NavItem) => {
    if (item.ownerOnly && !canManageTeam) return false;
    if (!item.slug) return true;
    return pageAccess === null || pageAccess.includes(item.slug);
  };

  const displayName = userName || userEmail.split("@")[0];

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href, item.exact);
    return (
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={cn(
          "group relative flex items-center rounded-lg text-[12.5px] font-medium transition-colors duration-150",
          collapsed ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-[7px]",
          active ? "bg-primary/15 text-white" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
        )}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-[2px] bg-primary" />}
        <item.Icon className={cn(
          "w-[15px] h-[15px] flex-shrink-0 transition-colors duration-150",
          active ? "text-primary" : "text-sidebar-muted group-hover:text-sidebar-foreground"
        )} />
        {!collapsed && <span className="flex-1">{item.label}</span>}
      </Link>
    );
  };

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter(canSee) }))
    .filter((g) => g.items.length > 0);
  const setup = SETUP_NAV.filter(canSee);

  return (
    <aside className={cn(
      "relative flex flex-col bg-sidebar border-r border-sidebar-border z-[1] overflow-hidden transition-[width] duration-200 ease-out",
      collapsed ? "w-14" : "w-56"
    )}>
      {/* Ambient top gradient */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-28 bg-gradient-to-b from-primary/[0.12] to-transparent" />

      {/* Logo + collapse toggle */}
      <div className={cn(
        "relative flex items-center border-b border-sidebar-border pt-4 pb-4",
        collapsed ? "flex-col gap-2 px-2" : "gap-2.5 px-4"
      )}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary text-primary-foreground shadow-sm">
          <TrendingUp className="w-3.5 h-3.5" />
        </div>
        {!collapsed && <p className="flex-1 font-semibold text-[13px] leading-none text-white tracking-tight">Finance OS</p>}
        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1 rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-white transition-colors flex-shrink-0"
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Org switcher (hidden on the rail) */}
      {!collapsed && accessibleOrgs.length > 0 && (
        <div className="px-2.5 pt-2.5">
          <OrgSwitcher orgs={accessibleOrgs} activeOrgId={org.id} canCreateOrg={canCreateOrg} />
        </div>
      )}

      {/* Grouped nav */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-2 space-y-1">
        {groups.map((g, gi) => (
          <div key={g.label}>
            {collapsed
              ? gi > 0 && <div className="mx-2 my-1.5 border-t border-sidebar-border/60" />
              : (
                <div className="px-3 pt-2 pb-1">
                  <span className="text-[9.5px] font-bold tracking-[0.16em] text-sidebar-muted uppercase">{g.label}</span>
                </div>
              )}
            <nav className={cn("space-y-px", collapsed ? "px-2" : "px-2.5")}>
              {g.items.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>
          </div>
        ))}

        {setup.length > 0 && (
          <div>
            {collapsed
              ? <div className="mx-2 my-1.5 border-t border-sidebar-border/60" />
              : (
                <div className="px-3 pt-2 pb-1">
                  <span className="text-[9.5px] font-bold tracking-[0.16em] text-sidebar-muted uppercase">Setup</span>
                </div>
              )}
            <nav className={cn("space-y-px", collapsed ? "px-2" : "px-2.5")}>
              {setup.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>
          </div>
        )}
      </div>

      {/* Connector / sync status (hidden on the rail) */}
      {!collapsed && connectorCount > 0 && (
        <div className="mx-2.5 mb-2 p-2.5 border border-sidebar-border rounded-lg bg-sidebar-accent/60">
          <div className="flex items-center gap-2 text-[11px] text-sidebar-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
            <span className="flex-1 font-medium text-sidebar-foreground">{connectorCount} connector{connectorCount !== 1 ? "s" : ""}</span>
            <span className="text-sidebar-muted font-mono text-[10px]">{liveCount} live</span>
          </div>
          {lastSyncedAt && (
            <div className="flex items-center gap-2 text-[11px] text-sidebar-muted mt-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-warning flex-shrink-0" />
              <span className="flex-1">Last sync</span>
              <span className="text-sidebar-muted font-mono text-[10px]">{timeAgo(lastSyncedAt)}</span>
            </div>
          )}
        </div>
      )}

      {/* User footer */}
      <div className={cn("border-t border-sidebar-border", collapsed ? "p-2 flex flex-col items-center gap-1" : "p-2.5")}>
        <Link
          href="/dashboard/profile"
          title={collapsed ? displayName : undefined}
          className={cn(
            "flex items-center rounded-lg hover:bg-sidebar-accent transition-colors group",
            collapsed ? "justify-center p-1" : "gap-2 px-2 py-1.5 mb-1"
          )}
        >
          <UserAvatar name={userName} email={userEmail} src={userAvatarUrl} size="sm" rounded="lg" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-sidebar-foreground truncate group-hover:text-white transition-colors">{displayName}</p>
              <p className="text-[10px] text-sidebar-muted truncate">{userEmail}</p>
            </div>
          )}
        </Link>
        <button
          onClick={handleSignOut}
          title={collapsed ? "Sign out" : undefined}
          className={cn(
            "flex items-center rounded-lg text-[12px] text-sidebar-muted hover:bg-destructive/15 hover:text-destructive transition-colors duration-150",
            collapsed ? "justify-center p-2" : "gap-2 w-full px-2 py-1.5"
          )}
        >
          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
          {!collapsed && "Sign out"}
        </button>
      </div>
    </aside>
  );
}
