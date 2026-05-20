import { Skeleton } from "@/components/ui/skeleton";

export default function RevenueLoading() {
  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="space-y-1">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card border rounded-xl p-6 space-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-card border rounded-xl p-6 space-y-3">
            <Skeleton className="h-5 w-36" />
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
