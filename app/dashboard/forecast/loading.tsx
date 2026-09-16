import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/forecast/page.tsx (ForecastClient): a PageHeader with
 * title/subtitle + right-aligned controls (size + reset), then one tall
 * projected-P&L table card.
 */
export default function ForecastLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header: title + subtitle, two pill controls on the right */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1.5">
          <Skeleton className="h-[19px] w-32" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
      </div>

      {/* Tall projected-P&L table */}
      <ChartCardSkeleton bodyClassName="h-[520px]" />
    </div>
  );
}
