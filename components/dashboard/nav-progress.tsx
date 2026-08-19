"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton-on-navigation for the dashboard.
 *
 * The analytics pages are server components that re-fetch when a filter changes
 * the URL (?from/&to). A search-param navigation does NOT trigger loading.tsx and
 * router.push exposes no pending state, so the page silently sat on stale data.
 * This provider routes those navigations through useTransition and, while the
 * server refetches, replaces the page body with a skeleton — so a date/filter
 * change visibly reloads. Client-fetch pages (Payments, Subscriptions) don't
 * navigate; they render their own in-table skeletons from their fetch state.
 */

type NavProgressCtx = {
  /** Navigate with a skeleton shown until the new server data is ready. */
  navigate: (href: string) => void;
  pending: boolean;
};

const Ctx = React.createContext<NavProgressCtx>({
  // Degrade gracefully if used outside the provider (shouldn't happen — layout wraps).
  navigate: (href) => { if (typeof window !== "undefined") window.location.href = href; },
  pending: false,
});

export function useNavProgress(): NavProgressCtx {
  return React.useContext(Ctx);
}

/** Neutral content skeleton for analytics pages (header + metric cards + chart + list). */
function ContentSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-6 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
        <div className="bg-card border border-border rounded-xl p-6 space-y-3">
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function NavProgressProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const navigate = React.useCallback(
    (href: string) => { startTransition(() => router.push(href)); },
    [router]
  );

  const value = React.useMemo<NavProgressCtx>(() => ({ navigate, pending }), [navigate, pending]);

  return (
    <Ctx.Provider value={value}>
      {pending ? <ContentSkeleton /> : children}
    </Ctx.Provider>
  );
}
