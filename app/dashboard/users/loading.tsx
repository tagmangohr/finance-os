import { Skeleton } from "@/components/ui/skeleton";

/** One member row: avatar + name/email + role pill + action icons. */
function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border bg-accent/40">
      <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-4 w-14 rounded-full" />
        </div>
        <Skeleton className="h-2.5 w-40" />
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Skeleton className="h-6 w-6 rounded-lg" />
        <Skeleton className="h-6 w-6 rounded-lg" />
        <Skeleton className="h-6 w-6 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Mirrors app/dashboard/users/page.tsx (+ UsersClient): a narrow max-w-2xl
 * column — "Team" title, then a per-org card with a header (name + count +
 * Add Users button) and a list of member rows.
 */
export default function UsersLoading() {
  return (
    <div className="max-w-2xl space-y-5">
      {/* Title */}
      <div className="space-y-1.5">
        <Skeleton className="h-[19px] w-20" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>

      {/* One org section */}
      <div className="rounded-2xl border border-border overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between border-b border-border bg-accent/40">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-7 w-24 rounded-lg" />
        </div>
        <div className="p-3 space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <MemberRowSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
