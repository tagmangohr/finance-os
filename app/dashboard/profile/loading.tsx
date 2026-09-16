import { Skeleton } from "@/components/ui/skeleton";

/** One labelled form field (uppercase label + input box). */
function FieldSkeleton() {
  return (
    <div className="space-y-1.5">
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
  );
}

/** A form-section card: icon + title header, then field rows. */
function SectionCardSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-7 w-7 rounded-lg" />
        <Skeleton className="h-3.5 w-32" />
      </div>
      {children}
    </div>
  );
}

/**
 * Mirrors app/dashboard/profile/page.tsx (+ ProfileClient): a narrow max-w-2xl
 * column — page title, a "Your Profile" card (avatar row + 2 fields), a
 * "Company Details" card (2 fields + a 2-up currency/timezone row), and a
 * save bar.
 */
export default function ProfileLoading() {
  return (
    <div className="max-w-2xl space-y-5">
      {/* Page title */}
      <div className="space-y-1.5">
        <Skeleton className="h-[19px] w-24" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>

      {/* Your Profile */}
      <SectionCardSkeleton>
        <div className="flex items-center gap-4 pb-1">
          <Skeleton className="h-16 w-16 rounded-2xl flex-shrink-0" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-2.5 w-48" />
          </div>
        </div>
        <FieldSkeleton />
        <FieldSkeleton />
      </SectionCardSkeleton>

      {/* Company Details */}
      <SectionCardSkeleton>
        <FieldSkeleton />
        <FieldSkeleton />
        <div className="grid grid-cols-2 gap-3">
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
      </SectionCardSkeleton>

      {/* Save bar */}
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>
    </div>
  );
}
