"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  TrendingUp, LayoutDashboard, Plug, Table2, Landmark, LogOut, User, Users,
  Repeat, Activity, Sheet, LineChart, type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { OrgSwitcher, type SwitcherOrg } from "@/components/dashboard/org-switcher";

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
    { href: "/dashboard/pnl",          slug: "pnl",          label: "Profit & Loss", Icon: Sheet },
    { href: "/dashboard/forecast",     slug: "forecast",     label: "Forecast",      Icon: LineChart },
  ]},
  { label: "Money in", items: [
    { href: "/dashboard/data",          slug: "data",          label: "Payments",      Icon: Table2 },
    { href: "/dashboard/revenue",       slug: "revenue",       label: "Revenue",       Icon: TrendingUp },
    { href: "/dashboard/subscriptions", slug: "subscriptions", label: "Subscriptions", Icon: Repeat },
  ]},
  { label: "Money out", items: [
    // "bank" is a grantable (PII) slug now — visible to owners/admins and members granted it.
    { href: "/dashboard/bank",     slug: "bank",     label: "Bank",      Icon: Landmark },
    { href: "/dashboard/cashflow", slug: "cashflow", label: "Cash flow", Icon: Activity },
  ]},
];

const SETUP_NAV: NavItem[] = [
  { href: "/dashboard/connectors", slug: "connectors", label: "Connectors", Icon: Plug },
  { href: "/dashboard/profile",    label: "Profile",   Icon: User },
  { href: "/dashboard/users",      label: "Team",      Icon: Users, ownerOnly: true },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SidebarNavProps {
  org:            { id: string; name: string };
  accessibleOrgs?: SwitcherOrg[];
  canCreateOrg?:  boolean;
  userEmail:      string;
  userName?:      string;
  /** null = owner/admin (all pages visible); string[] = specific slugs allowed */
  pageAccess?:    string[] | null;
  canManageTeam?: boolean;
  connectorCount?: number;
  liveCount?:      number;
  lastSyncedAt?:   string | null;
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
  pageAccess   = null,
  canManageTeam = true,
  connectorCount = 0,
  liveCount      = 0,
  lastSyncedAt,
}: SidebarNavProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const supabase = createClient();

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
  const avatarLetter = (userName?.charAt(0) || userEmail.charAt(0)).toUpperCase();

  const NavLink = ({ item }: { item: NavItem }) => {
    const active = isActive(item.href, item.exact);
    return (
      <Link
        href={item.href}
        className={cn(
          "group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12.5px] font-medium transition-colors duration-150",
          active ? "bg-primary/15 text-white" : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white"
        )}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-[2px] bg-primary" />}
        <item.Icon className={cn(
          "w-[15px] h-[15px] flex-shrink-0 transition-colors duration-150",
          active ? "text-primary" : "text-sidebar-muted group-hover:text-sidebar-foreground"
        )} />
        <span className="flex-1">{item.label}</span>
      </Link>
    );
  };

  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter(canSee) }))
    .filter((g) => g.items.length > 0);
  const setup = SETUP_NAV.filter(canSee);

  return (
    <aside className="relative flex flex-col w-56 bg-sidebar border-r border-sidebar-border z-[1]">
      {/* Ambient top gradient */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-28 bg-gradient-to-b from-primary/[0.12] to-transparent" />

      {/* Logo */}
      <div className="relative flex items-center gap-2.5 px-4 pt-4 pb-4 border-b border-sidebar-border">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary text-primary-foreground shadow-sm">
          <TrendingUp className="w-3.5 h-3.5" />
        </div>
        <p className="font-semibold text-[13px] leading-none text-white tracking-tight">Finance OS</p>
      </div>

      {/* Org switcher */}
      {accessibleOrgs.length > 0 && (
        <div className="px-2.5 pt-2.5">
          <OrgSwitcher orgs={accessibleOrgs} activeOrgId={org.id} canCreateOrg={canCreateOrg} />
        </div>
      )}

      {/* Grouped nav */}
      <div className="flex-1 overflow-y-auto py-2 space-y-1">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 pt-2 pb-1">
              <span className="text-[9.5px] font-bold tracking-[0.16em] text-sidebar-muted uppercase">{g.label}</span>
            </div>
            <nav className="px-2.5 space-y-px">
              {g.items.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>
          </div>
        ))}

        {setup.length > 0 && (
          <div>
            <div className="px-3 pt-2 pb-1">
              <span className="text-[9.5px] font-bold tracking-[0.16em] text-sidebar-muted uppercase">Setup</span>
            </div>
            <nav className="px-2.5 space-y-px">
              {setup.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>
          </div>
        )}
      </div>

      {/* Connector / sync status */}
      {connectorCount > 0 && (
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
      <div className="p-2.5 border-t border-sidebar-border">
        <Link
          href="/dashboard/profile"
          className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded-lg hover:bg-sidebar-accent transition-colors group"
        >
          <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-primary-foreground bg-primary">
            {avatarLetter}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-sidebar-foreground truncate group-hover:text-white transition-colors">{displayName}</p>
            <p className="text-[10px] text-sidebar-muted truncate">{userEmail}</p>
          </div>
        </Link>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[12px] text-sidebar-muted hover:bg-destructive/15 hover:text-destructive transition-colors duration-150"
        >
          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
