"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Invisible component that calls router.refresh() every INTERVAL ms.
 * This re-fetches all server-component data (Supabase queries) so the
 * dashboard stays current after hourly auto-syncs without a hard reload.
 */
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function AutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
