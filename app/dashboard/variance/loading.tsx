import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/variance/page.tsx (VarianceClient): a PageHeader with
 * title/subtitle + right-aligned controls (FY picker, view toggle, size,
 * export), then one tall forecast-vs-actuals table card.
 */
export default function VarianceLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header: title + subtitle, control cluster on the right */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1.5">
          <Skeleton className="h-[19px] w-32" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-56 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
      </div>

      {/* Tall variance table */}
      <ChartCardSkeleton bodyClassName="h-[520px]" />
    </div>
  );
}
