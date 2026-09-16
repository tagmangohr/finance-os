import { Skeleton } from "@/components/ui/skeleton";
import { TableCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/pnl/pnl-client.tsx: "Profit & Loss" title + subtitle with
 * a wide toolbar (mode toggle, FY picker, change toggle, text-size, Expand,
 * Review, CSV/Excel), then the Excel-style month × category P&L grid — a wide
 * bordered table with a "Particulars" column plus the period columns.
 */
export default function PnlLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header: title + subtitle (left), toolbar controls (right) */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1.5">
          <Skeleton className="h-[19px] w-44" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-8 w-64 rounded-lg" />
          <Skeleton className="h-8 w-40 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </div>

      {/* Month × category P&L grid */}
      <TableCardSkeleton rows={16} cols={7} />
    </div>
  );
}
