import { Skeleton } from "@/components/ui/skeleton";

export default function CashFlowLoading() {
  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="space-y-1">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card border rounded-xl p-6 space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-3">
        <Skeleton className="h-5 w-48" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex justify-between items-center">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border rounded-xl p-6 space-y-3">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </div>
  );
}
