import { RangeBarSkeleton, MetricCardsGridSkeleton, ChartCardSkeleton, ListCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/revenue/page.tsx: right-aligned range filter, a 5-card
 * row, then a 2:1 row of the revenue chart + the Top-Customers panel.
 */
export default function RevenueLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      <RangeBarSkeleton />

      <MetricCardsGridSkeleton count={5} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ChartCardSkeleton className="lg:col-span-2" bodyClassName="h-64" />
        <ListCardSkeleton rows={6} />
      </div>
    </div>
  );
}
