import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/dashboard/skeletons";

/** A settings section card: icon + title/description header, then body rows. */
function SettingsSectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start gap-2 flex-wrap">
        <Skeleton className="h-4 w-4 rounded flex-shrink-0" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-2.5 w-80 max-w-full" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    </section>
  );
}

/**
 * Mirrors app/dashboard/settings/page.tsx (SettingsClient): a max-w-[900px]
 * column — "Settings" header then the stacked setting sections (connector P&L
 * treatment, API keys, outbound webhooks, and the Payments Search API docs).
 */
export default function SettingsLoading() {
  return (
    <div className="space-y-4 max-w-[900px]">
      <PageHeaderSkeleton />
      <div className="space-y-6">
        <SettingsSectionSkeleton rows={3} />
        <SettingsSectionSkeleton rows={2} />
        <SettingsSectionSkeleton rows={2} />
        <SettingsSectionSkeleton rows={2} />
      </div>
    </div>
  );
}
