import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors app/dashboard/connectors/connectors-client.tsx: a header banner with a
 * title + a right-aligned summary strip (Sources / Accounts / Live), then a
 * lg:grid-cols-3 grid of connector cards (icon + name + status pill + button).
 * Rebuilt from the shared bg-muted Skeleton primitive.
 */
export default function ConnectorsLoading() {
  return (
    <div className="space-y-6 max-w-[1400px]">
      {/* Header banner + summary strip */}
      <div className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3.5 w-96 max-w-full" />
          </div>
          <div className="flex items-center gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-6 w-10" />
                <Skeleton className="h-2.5 w-14" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Connector card grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Skeleton className="h-9 w-9 rounded-xl flex-shrink-0" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-2.5 w-36" />
                </div>
              </div>
              <Skeleton className="h-5 w-12 rounded-full flex-shrink-0" />
            </div>
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
