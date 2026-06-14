"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Calendar, ChevronDown, SlidersHorizontal, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard",              slug: "dashboard",    label: "Snapshot",     exact: true },
  { href: "/dashboard/revenue",      slug: "revenue",      label: "Revenue",      exact: false },
  { href: "/dashboard/cashflow",     slug: "cashflow",     label: "Cash Flow",    exact: false },
  { href: "/dashboard/collections",  slug: "collections",  label: "Collections",  exact: false },
  { href: "/dashboard/intelligence", slug: "intelligence", label: "Intelligence", exact: false },
];

// Display-only for now — wiring the range into every page's queries is a follow-up.
const RANGES = ["This month", "Last 30 days", "This quarter", "This year", "All time"];

export function DashboardTabs({ pageAccess }: { pageAccess?: string[] | null }) {
  const pathname = usePathname();
  const [range, setRange] = useState("This month");

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
      {/* Title + date range + filter */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h1 className="text-[18px] font-bold tracking-tight text-foreground">Dashboard</h1>
        <div className="flex items-center gap-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="flex items-center gap-2 h-8 px-3 rounded-lg text-[12px] text-muted-foreground bg-card border border-border hover:border-border/80 transition-colors">
                <Calendar className="w-3.5 h-3.5" />
                {range}
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={6}
                className="z-50 min-w-[160px] rounded-xl border border-border bg-popover p-1.5 shadow-2xl"
              >
                {RANGES.map((r) => (
                  <DropdownMenu.Item
                    key={r}
                    onSelect={() => setRange(r)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12.5px] text-foreground/80 hover:bg-accent focus:bg-accent cursor-pointer outline-none"
                  >
                    <span className="flex-1">{r}</span>
                    {range === r && <Check className="w-3.5 h-3.5 text-primary" />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <button
            aria-label="Filters"
            className="h-8 px-2.5 rounded-lg text-muted-foreground bg-card border border-border hover:border-border/80 transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
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
