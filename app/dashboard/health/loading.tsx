import { Skeleton } from "@/components/ui/skeleton";

/** A SectionCard shell (title/subtitle header) wrapping arbitrary body. */
function SectionCardSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 pt-3.5 pb-3 space-y-1.5">
        <Skeleton className="h-2.5 w-28" />
        <Skeleton className="h-2 w-56 max-w-full" />
      </div>
      <div className="px-4 pb-4">{children}</div>
    </div>
  );
}

/**
 * Mirrors app/dashboard/health/page.tsx (HealthClient): a header with title +
 * refresh, a status banner, the "Connectors" section (rows with a health dot +
 * name/type), and the "Scheduled jobs" section (cron rows).
 */
export default function HealthLoading() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-2.5 w-72 max-w-full" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>

      {/* Status banner */}
      <Skeleton className="h-14 w-full rounded-xl" />

      {/* Connectors */}
      <SectionCardSkeleton>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
              <Skeleton className="h-2.5 w-2.5 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-2.5 w-56 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </SectionCardSkeleton>

      {/* Scheduled jobs */}
      <SectionCardSkeleton>
        <div className="rounded-xl border border-border divide-y divide-border/40 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <Skeleton className="h-2.5 w-2.5 rounded-full flex-shrink-0" />
              <Skeleton className="h-3 w-36 flex-shrink-0" />
              <Skeleton className="h-3 flex-1" />
            </div>
          ))}
        </div>
      </SectionCardSkeleton>
    </div>
  );
}
