import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
