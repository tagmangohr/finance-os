import { PageHeaderSkeleton, MetricCardsGridSkeleton, ChartCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/analytics/analytics-client.tsx: "Analytics" title +
 * subtitle with a right-aligned date-range picker, a 5-card headline row
 * (CustomizableCards, grid-cols-2 lg:grid-cols-5 — no Customize button now),
 * then the 2-up grid of chart tiles (lg:grid-cols-2, ~260px each).
 */
export default function AnalyticsLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      <PageHeaderSkeleton withRange subtitle />

      <MetricCardsGridSkeleton count={5} className="grid grid-cols-2 lg:grid-cols-5 gap-3" />

      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCardSkeleton bodyClassName="h-[260px]" />
        <ChartCardSkeleton bodyClassName="h-[260px]" />
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        <ChartCardSkeleton bodyClassName="h-[260px]" />
        <ChartCardSkeleton bodyClassName="h-[260px]" />
      </div>
    </div>
  );
}
