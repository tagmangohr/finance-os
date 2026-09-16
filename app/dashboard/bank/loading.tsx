import { Skeleton } from "@/components/ui/skeleton";
import { MetricCardsGridSkeleton, ListCardSkeleton, TableCardSkeleton } from "@/components/dashboard/skeletons";

/**
 * Mirrors app/dashboard/bank/bank-client.tsx: a header row (date-range picker on
 * the left, Auto-categorize + CSV/Excel actions on the right) with a caption
 * line, the reconciled P&L + runway strip (CustomizableCards, 8 cards on a
 * 2/4-up grid — no Customize button now), the "Expenses by category" ranked
 * list, then the "Transactions" table.
 */
export default function BankLoading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header: range picker (left) + actions (right) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Skeleton className="h-9 w-36 rounded-lg" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="h-8 w-16 rounded-lg" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-3 w-80" />

      <MetricCardsGridSkeleton count={8} className="grid grid-cols-2 lg:grid-cols-4 gap-3" />

      <ListCardSkeleton rows={8} />

      <TableCardSkeleton rows={8} cols={8} />
    </div>
  );
}
