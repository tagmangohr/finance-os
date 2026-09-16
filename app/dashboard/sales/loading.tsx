import { Skeleton } from "@/components/ui/skeleton";
import { MetricCardsGridSkeleton, ChartCardSkeleton, ListCardSkeleton, TableCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/sales/page.tsx (SalesClient, populated state): a
 * date-range header + caption, a 4-card metric row, the "Sales over time"
 * trend, the "Sales breakdown" list, and the "Sales records" table.
 */
export default function SalesLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header: date-range picker (left-aligned) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-9 w-64 rounded-lg" />
      </div>
      <Skeleton className="h-2.5 w-96 max-w-full" />

      {/* Smart cards */}
      <MetricCardsGridSkeleton count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-3" />

      {/* Trend */}
      <ChartCardSkeleton bodyClassName="h-40" />

      {/* Breakdown */}
      <ListCardSkeleton rows={6} />

      {/* Sales records table */}
      <TableCardSkeleton rows={8} cols={5} />
    </div>
  );
}
