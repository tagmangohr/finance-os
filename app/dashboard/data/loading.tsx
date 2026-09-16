import { Skeleton } from "@/components/ui/skeleton";
import { MetricCardsGridSkeleton, TableCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/data/data-client.tsx (the Payments / Raw Data tab):
 * "Raw Transaction Data" title + subtitle, a filters toolbar (search, connector /
 * source / type selects, date range, export), the summary-card strip
 * (CustomizableCards, 7 cards on a 2/4/7-up grid), then the big transactions table.
 */
export default function DataLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header */}
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-96 max-w-full" />
      </div>

      {/* Filters toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 flex-1 min-w-[180px] rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Summary cards */}
      <MetricCardsGridSkeleton count={7} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5" />

      {/* Transactions table */}
      <TableCardSkeleton rows={10} cols={8} />
    </div>
  );
}
