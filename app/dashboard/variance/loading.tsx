import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-3 max-w-[1400px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40 rounded" />
          <Skeleton className="h-4 w-72 rounded" />
        </div>
        <div className="flex gap-2"><Skeleton className="h-8 w-28 rounded-lg" /><Skeleton className="h-8 w-56 rounded-lg" /></div>
      </div>
      <Skeleton className="h-[520px] rounded-xl" />
    </div>
  );
}
