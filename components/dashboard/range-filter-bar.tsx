"use client";

import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useNavProgress } from "@/components/dashboard/nav-progress";

/**
 * Thin client wrapper that drops the shared DateRangePicker into a server page and
 * pushes the chosen window to the URL (?from/?to), so the server re-fetches the
 * page scoped to that range. Used on the analytics pages (Revenue, Cashflow).
 *
 * Routes the navigation through NavProgress so the top loading bar shows while the
 * server refetches — a search-param change never triggers loading.tsx on its own.
 */
export function RangeFilterBar({
  basePath,
  from,
  to,
  variant = "dark",
}: {
  basePath: string;
  from: string;
  to: string;
  /** Trigger styling — defaults to the solid black treatment (Dashboard/Revenue/Cash Flow). */
  variant?: "default" | "dark";
}) {
  const { navigate } = useNavProgress();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <DateRangePicker
      from={from}
      to={to}
      max={today}
      align="end"
      variant={variant}
      onChange={(f, t) => navigate(`${basePath}?from=${f}&to=${t}`)}
    />
  );
}
