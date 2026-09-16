import { RangeBarSkeleton, MetricCardsGridSkeleton, ChartCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/cashflow/page.tsx: right-aligned range filter, a 4-card
 * row, then a 2:1 row of the Inflow/Outflow chart + Expense Breakdown chart.
 */
export default function CashflowLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      <RangeBarSkeleton />

      <MetricCardsGridSkeleton count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-3" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <ChartCardSkeleton className="lg:col-span-2" bodyClassName="h-[260px]" />
        <ChartCardSkeleton bodyClassName="h-[260px]" />
      </div>
    </div>
  );
}
