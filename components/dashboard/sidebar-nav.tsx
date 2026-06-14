"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  TrendingUp, LayoutDashboard, DollarSign, ArrowLeftRight,
  Brain, Plug, Table2, LogOut, User, Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { OrgSwitcher, type SwitcherOrg } from "@/components/dashboard/org-switcher";

// ─── Nav definitions ──────────────────────────────────────────────────────────

const workspaceNav = [
  { href: "/dashboard",              slug: "dashboard",    label: "War Room",     Icon: LayoutDashboard, exact: true,  hint: "⌘1" },
  { href: "/dashboard/revenue",      slug: "revenue",      label: "Revenue",      Icon: TrendingUp,      exact: false, hint: "⌘2" },
  { href: "/dashboard/cashflow",     slug: "cashflow",     label: "Cash Flow",    Icon: ArrowLeftRight,  exact: false, hint: "⌘3" },
  { href: "/dashboard/collections",  slug: "collections",  label: "Collections",  Icon: DollarSign,      exact: false, hint: "⌘4" },
  { href: "/dashboard/intelligence", slug: "intelligence", label: "Intelligence", Icon: Brain,           exact: false, hint: "⌘5" },
  { href: "/dashboard/connectors",   slug: "connectors",   label: "Connectors",   Icon: Plug,            exact: false, hint: "⌘6" },
  { href: "/dashboard/data",         slug: "data",         label: "Raw Data",     Icon: Table2,          exact: false, hint: "⌘7" },
];

const settingsNav = [
  { href: "/dashboard/profile", label: "Profile", Icon: User,  ownerOnly: false },
  { href: "/dashboard/users",   label: "Team",    Icon: Users, ownerOnly: true  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SidebarNavProps {
  org:            { id: string; name: string };
  /** All orgs the user can switch between (owned + member). */
  accessibleOrgs?: SwitcherOrg[];
  /** Whether the user may create new orgs (owner/admin of ≥1 org). */
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

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  // Filter workspace nav by page access (null = all allowed)
  const visibleWorkspace = pageAccess === null
    ? workspaceNav
    : workspaceNav.filter((item) => pageAccess.includes(item.slug));

  const displayName = userName || userEmail.split("@")[0];
  const avatarLetter = (userName?.charAt(0) || userEmail.charAt(0)).toUpperCase();

  return (
    <aside className="relative flex flex-col w-56 bg-card border-r border-border z-[1]">
      {/* Ambient top gradient */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-28 bg-gradient-to-b from-primary/[0.06] to-transparent" />

      {/* Logo */}
      <div className="relative flex items-center gap-2.5 px-4 pt-4 pb-4 border-b border-border">
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
          <p className="font-semibold text-[13px] leading-none text-foreground tracking-tight">Finance OS</p>
        </div>
      </div>

      {/* Org switcher */}
      {accessibleOrgs.length > 0 && (
        <div className="px-2.5 pt-2.5">
          <OrgSwitcher orgs={accessibleOrgs} activeOrgId={org.id} canCreateOrg={canCreateOrg} />
        </div>
      )}

      {/* Workspace nav */}
      <div className="px-3 pt-3 pb-1">
        <span className="text-[9.5px] font-bold tracking-[0.16em] text-muted-foreground/70 uppercase">Workspace</span>
      </div>
      <nav className="px-2.5 space-y-px">
        {visibleWorkspace.map((item) => {
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12.5px] font-medium transition-all duration-150",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-[2px] bg-primary"
                  style={{ boxShadow: "0 0 8px rgba(124,82,240,0.6)" }}
                />
              )}
              <item.Icon className={cn(
                "w-[15px] h-[15px] flex-shrink-0 transition-colors duration-150",
                active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
              )} />
              <span className="flex-1">{item.label}</span>
              <span className={cn(
                "text-[9.5px] font-mono flex-shrink-0",
                active ? "text-primary/50" : "text-muted-foreground/50 group-hover:text-muted-foreground"
              )}>
                {item.hint}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Settings nav */}
      <div className="px-3 pt-3 pb-1 mt-2">
        <span className="text-[9.5px] font-bold tracking-[0.16em] text-muted-foreground/70 uppercase">Settings</span>
      </div>
      <nav className="px-2.5 space-y-px">
        {settingsNav
          .filter((item) => !item.ownerOnly || canManageTeam)
          .map((item) => {
            const active = isActive(item.href, false);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-[12.5px] font-medium transition-all duration-150",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-[2px] bg-primary"
                    style={{ boxShadow: "0 0 8px rgba(124,82,240,0.6)" }}
                  />
                )}
                <item.Icon className={cn(
                  "w-[15px] h-[15px] flex-shrink-0 transition-colors duration-150",
                  active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )} />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
      </nav>

      {/* Connector status */}
      {connectorCount > 0 && (
        <div className="mx-2.5 mt-3 mb-2 p-2 border border-border rounded-lg bg-accent/40">
          <div className="text-[9.5px] font-bold tracking-[0.14em] text-muted-foreground/70 uppercase mb-2">Status</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"
                style={{ boxShadow: "0 0 6px rgba(29,184,132,0.6)" }} />
              <span className="flex-1">{connectorCount} connector{connectorCount !== 1 ? "s" : ""}</span>
              <span className="text-muted-foreground/70 font-mono text-[10px]">{liveCount} live</span>
            </div>
            {lastSyncedAt && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="flex-1">Last sync</span>
                <span className="text-muted-foreground/70 font-mono text-[10px]">{timeAgo(lastSyncedAt)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User footer */}
      <div className="p-2.5 border-t border-border mt-auto">
        <Link
          href="/dashboard/profile"
          className="flex items-center gap-2 px-2 py-1.5 mb-1 rounded-lg hover:bg-accent transition-all group"
        >
          <div
            className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white"
            style={{ background: "linear-gradient(135deg, #2a3a6f, #0f1628)" }}
          >
            {avatarLetter}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-foreground/80 truncate group-hover:text-foreground transition-colors">
              {displayName}
            </p>
            <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
          </div>
        </Link>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-150"
        >
          <LogOut className="w-3.5 h-3.5 flex-shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
