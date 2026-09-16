import { PageHeaderSkeleton, MetricStripSkeleton, ChartCardSkeleton, TableCardSkeleton, ListCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/subscriptions/subscriptions-client.tsx: "Subscriptions"
 * title + subtitle (no range), the customizable SubscriptionMetricStrip ("Key
 * metrics" header + Customize button, 8 cards by default on a 2/3/4-up grid),
 * the "Growth over time" chart card, a 2:1 row (By-gateway table + Contract-mix
 * list), the cohort-retention heatmap card, then the paginated Customers table.
 */
export default function SubscriptionsLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      <PageHeaderSkeleton subtitle />

      <MetricStripSkeleton count={8} gridClassName="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" />

      <ChartCardSkeleton bodyClassName="h-[320px]" />

      <div className="grid lg:grid-cols-2 gap-3">
        <TableCardSkeleton rows={5} cols={6} />
        <ListCardSkeleton rows={4} />
      </div>

      <ChartCardSkeleton bodyClassName="h-40" />

      <TableCardSkeleton rows={8} cols={7} />
    </div>
  );
}
