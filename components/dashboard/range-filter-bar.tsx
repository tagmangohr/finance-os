"use client";

import { useRouter } from "next/navigation";
import { DateRangePicker } from "@/components/ui/date-range-picker";

/**
 * Thin client wrapper that drops the shared DateRangePicker into a server page and
 * pushes the chosen window to the URL (?from/?to), so the server re-fetches the
 * page scoped to that range. Used on the analytics pages (Revenue, Cashflow).
 */
export function RangeFilterBar({ basePath, from, to }: { basePath: string; from: string; to: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <DateRangePicker
      from={from}
      to={to}
      max={today}
      align="end"
      onChange={(f, t) => router.push(`${basePath}?from=${f}&to=${t}`)}
    />
  );
}
