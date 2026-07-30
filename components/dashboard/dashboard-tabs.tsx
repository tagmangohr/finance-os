"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard",              slug: "dashboard",    label: "Snapshot",     exact: true },
  { href: "/dashboard/revenue",      slug: "revenue",      label: "Revenue",      exact: false },
  { href: "/dashboard/cashflow",     slug: "cashflow",     label: "Cash Flow",    exact: false },
  { href: "/dashboard/collections",  slug: "collections",  label: "Collections",  exact: false },
  { href: "/dashboard/subscriptions", slug: "subscriptions", label: "Subscriptions", exact: false },
  { href: "/dashboard/intelligence", slug: "intelligence", label: "Intelligence", exact: false },
];

export function DashboardTabs({ pageAccess }: { pageAccess?: string[] | null }) {
  const pathname = usePathname();

  const onAnalyticalRoute = TABS.some((t) =>
    t.exact ? pathname === t.href : pathname.startsWith(t.href)
  );
  if (!onAnalyticalRoute) return null;

  const visibleTabs = pageAccess == null ? TABS : TABS.filter((t) => pageAccess.includes(t.slug));

  function isActive(t: (typeof TABS)[number]) {
    return t.exact ? pathname === t.href : pathname.startsWith(t.href);
  }

  return (
    <div className="border-b border-border bg-background/60 px-4 sm:px-5 pt-3 flex-shrink-0">
      {/* Title (the non-functional date-range + filters controls were removed — they
          didn't filter anything; a real, wired range filter can be added later). */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h1 className="text-[18px] font-bold tracking-tight text-foreground">Dashboard</h1>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-5 overflow-x-auto">
        {visibleTabs.map((t) => {
          const active = isActive(t);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "relative whitespace-nowrap pb-2.5 text-[13px] transition-colors",
                active ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {active && <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-primary" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
