import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar skeleton */}
      <div className="hidden lg:flex flex-col w-60 border-r border-border bg-card flex-shrink-0 p-4 gap-3">
        <Skeleton className="h-9 w-36 mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-lg" />
        ))}
        <div className="mt-auto pt-4 border-t border-border space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>

      {/* Main content skeleton */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>

        <div className="flex-1 p-6 space-y-6 bg-background">
          {/* Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card border rounded-xl p-6 space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>

          {/* Alert banner */}
          <div className="flex gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-48 rounded-lg flex-shrink-0" />
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-card border rounded-xl p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
            <div className="bg-card border rounded-xl p-6 space-y-3">
              <Skeleton className="h-5 w-24" />
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex justify-between items-center py-1">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-card border rounded-xl p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-56 w-full rounded-lg" />
            </div>
            <div className="bg-card border rounded-xl p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-56 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
