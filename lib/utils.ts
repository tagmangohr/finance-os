import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The organisation's base/reporting currency. All cross-currency aggregation
 *  is normalised to this. */
export const BASE_CURRENCY = "INR";

/**
 * Base-currency (INR) amount for a transaction row. Uses the stored
 * `amount_base` (the converted figure — for Stripe, the real settled INR amount)
 * and falls back to the raw `amount` for rows already in the base currency or
 * not yet re-synced. Every aggregation must sum THIS, never raw `amount`, or it
 * will add USD/EUR figures to rupees.
 */
export function baseAmt(row: { amount_base?: number | string | null; amount: number | string }): number {
  return Number(row.amount_base ?? row.amount);
}

// Format currency — always display in local format
export function formatCurrency(
  amount: number,
  currency: string = "INR",
  compact: boolean = false
): string {
  if (compact) {
    if (Math.abs(amount) >= 10000000) {
      return `${currency === "INR" ? "₹" : "$"}${(amount / 10000000).toFixed(2)}Cr`;
    }
    if (Math.abs(amount) >= 100000) {
      return `${currency === "INR" ? "₹" : "$"}${(amount / 100000).toFixed(2)}L`;
    }
    if (Math.abs(amount) >= 1000) {
      return `${currency === "INR" ? "₹" : "$"}${(amount / 1000).toFixed(1)}K`;
    }
  }

  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Format date — always local, exact
export function formatDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd MMM yyyy");
}

export function formatDateShort(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "dd MMM");
}

export function formatDateRelative(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatDistanceToNow(d, { addSuffix: true });
}

/**
 * First day (YYYY-MM-DD) of the Indian financial year that `ref` falls in. The FY
 * runs 1 Apr → 31 Mar, so Jan–Mar belong to the FY that began the previous April.
 * Computed in IST so the boundary doesn't shift for late-night UTC. This is the
 * default "sync from" date — re-scanning the whole FY reconciles refunds/disputes
 * on older orders, not just recent activity.
 */
export function fyStartISO(ref: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
  }).formatToParts(ref);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value); // 1–12
  return `${month >= 4 ? year : year - 1}-04-01`;
}

/**
 * First day (YYYY-MM-DD) of the calendar month that `ref` falls in, computed in IST
 * (the reporting timezone) so the boundary doesn't shift for late-night UTC. Used as
 * the default range for operational views (e.g. the Bank ledger) that should open on
 * the current month, not the whole financial year.
 */
export function monthStartISO(ref: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit",
  }).formatToParts(ref);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value; // "01"–"12"
  return `${year}-${month}-01`;
}

// Format percentage
export function formatPercent(value: number, decimals: number = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

// Format days into human-readable runway
export function formatRunway(days: number): string {
  if (days <= 0) return "Critical — No runway";
  if (days < 30) return `${days} days`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    return remainingDays > 0 ? `${months}mo ${remainingDays}d` : `${months} months`;
  }
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  return months > 0 ? `${years}y ${months}mo` : `${years} years`;
}

// Runway severity
export function runwaySeverity(days: number): "critical" | "warning" | "good" {
  if (days <= 60) return "critical";
  if (days <= 120) return "warning";
  return "good";
}

// Determine MoM growth
export function calcGrowth(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

// Truncate text
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + "…";
}

// Debounce
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
