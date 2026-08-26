"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Invisible component that keeps every dashboard page current without a hard
 * reload. Mounted once in the dashboard layout, so it covers all pages (War Room,
 * P&L, Analytics, Bank, …). router.refresh() re-runs the server components — i.e.
 * re-queries the fast rollups — so pages reflect newly-synced data.
 *
 *  • Every 5 minutes on a timer (matches the rest of the app), AND
 *  • The moment the tab regains focus / becomes visible again — so switching back
 *    while data is arriving shows the latest immediately instead of waiting out
 *    the interval. Focus refreshes are throttled so rapid tab-switching can't spam.
 */
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FOCUS_THROTTLE_MS = 30 * 1000; // don't refetch more than once per 30s on focus

export function AutoRefresh() {
  const router = useRouter();
  const lastRef = useRef(0);

  useEffect(() => {
    const refresh = () => { lastRef.current = Date.now(); router.refresh(); };

    const id = setInterval(refresh, INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRef.current < FOCUS_THROTTLE_MS) return;
      refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  return null;
}
