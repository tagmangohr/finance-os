import { Skeleton } from "@/components/ui/skeleton";
import { MetricStripSkeleton, ChartCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/page.tsx. Renders ONLY the page's inner content — the
 * layout already provides the sidebar + top bar + padding, so this must not draw
 * its own shell.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header: "Overview" title + subtitle, range filter on the right */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-[19px] w-40" />
          <Skeleton className="h-3 w-72" />
        </div>
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      {/* Key-metrics strip — default 20 cards, 5-up on desktop */}
      <MetricStripSkeleton
        count={20}
        gridClassName="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
        cardClassName="min-h-[100px]"
      />

      {/* Inflow vs Outflow (2/3) + MRR movement (1/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ChartCardSkeleton className="lg:col-span-2" bodyClassName="h-64" />
        <ChartCardSkeleton bodyClassName="h-64" />
      </div>
    </div>
  );
}
