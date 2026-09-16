import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Shared skeleton building blocks that mirror the real dashboard components
 * (MetricCard, SectionCard, MetricStrip, PageHeader). Every route-level
 * loading.tsx composes these so the loading state matches the page it stands in
 * for — same grid, same card counts, same card shape — and every skeleton shares
 * one visual style (the `bg-muted` Skeleton primitive).
 *
 * NOTE: a route's loading.tsx renders INSIDE the dashboard layout's <main>
 * (which already provides the sidebar + top bar + padding). Skeletons must render
 * only the page's inner content — never a sidebar/top-bar shell.
 */

/** Page title + subtitle, optional right-aligned range/control placeholder. */
export function PageHeaderSkeleton({ withRange = false, subtitle = true }: { withRange?: boolean; subtitle?: boolean }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div className="space-y-1.5">
        <Skeleton className="h-[19px] w-44" />
        {subtitle && <Skeleton className="h-3 w-64" />}
      </div>
      {withRange && <Skeleton className="h-9 w-36 rounded-lg" />}
    </div>
  );
}

/** Right-aligned date-range placeholder (tabs with no page title). */
export function RangeBarSkeleton() {
  return (
    <div className="flex items-center justify-end">
      <Skeleton className="h-9 w-36 rounded-lg" />
    </div>
  );
}

/** Mirrors MetricCard: accent stripe, icon chip + title, value, subtitle. */
export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-border bg-card pl-3.5 pr-3 py-3 flex flex-col gap-2", className)}>
      <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-muted" />
      <div className="flex items-center gap-1.5 min-h-[24px]">
        <Skeleton className="h-6 w-6 rounded-md" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="h-[22px] w-24" />
      <Skeleton className="h-2.5 w-16" />
    </div>
  );
}

/** A grid of N metric cards (no header) — matches a CustomizableCards row. */
export function MetricCardsGridSkeleton({ count, className, cardClassName }: { count: number; className: string; cardClassName?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <MetricCardSkeleton key={i} className={cardClassName} />
      ))}
    </div>
  );
}

/** Mirrors MetricStrip: "Key metrics" header (+ optional Customize button) then a grid. */
export function MetricStripSkeleton({ count, gridClassName, showCustomize = true, cardClassName }: { count: number; gridClassName: string; showCustomize?: boolean; cardClassName?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24" />
        {showCustomize && <Skeleton className="h-7 w-24 rounded-lg" />}
      </div>
      <div className={gridClassName}>
        {Array.from({ length: count }).map((_, i) => (
          <MetricCardSkeleton key={i} className={cardClassName} />
        ))}
      </div>
    </div>
  );
}

/** Mirrors SectionCard wrapping a chart body. */
export function ChartCardSkeleton({ className, bodyClassName = "h-64" }: { className?: string; bodyClassName?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="px-4 pt-3.5 pb-0 space-y-1.5">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-2 w-20" />
      </div>
      <div className="px-4 pb-4 pt-2">
        <Skeleton className={cn("w-full rounded-lg", bodyClassName)} />
      </div>
    </div>
  );
}

/** Mirrors SectionCard wrapping a list body (label + value rows). */
export function ListCardSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="px-4 pt-3.5 pb-0">
        <Skeleton className="h-2.5 w-24" />
      </div>
      <div className="px-4 pb-4 pt-3 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Generic bordered table card (header row + body rows). */
export function TableCardSkeleton({ rows = 8, cols = 4, className }: { rows?: number; cols?: number; className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden", className)}>
      <div className="border-b border-border px-4 py-3 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-4 py-3 flex gap-4">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-3 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
