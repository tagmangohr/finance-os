import { NextResponse } from "next/server";

export const CONNECTOR_TYPES = [
  "razorpay",
  "stripe",
  "zoho",
  "quickbooks",
  "tally",
  "csv",
  "bank_statement",
  "cashfree",
  "payu",
  "paytm",
  "easebuzz",
] as const;

export const CONNECTOR_STATUSES = ["active", "inactive", "error"] as const;

const TRANSACTION_SORT_COLUMNS = new Set([
  "transaction_date",
  "amount",
  "source",
  "type",
  "status",
  "counterparty_name",
  "created_at",
]);

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function isConnectorType(value: unknown): value is typeof CONNECTOR_TYPES[number] {
  return typeof value === "string" && CONNECTOR_TYPES.includes(value as typeof CONNECTOR_TYPES[number]);
}

export function isConnectorStatus(value: unknown): value is typeof CONNECTOR_STATUSES[number] {
  return typeof value === "string" && CONNECTOR_STATUSES.includes(value as typeof CONNECTOR_STATUSES[number]);
}

export function parseSyncDateRange(
  fromRaw?: string,
  toRaw?: string
):
  | { fromDate: Date; toDate: Date }
  | { error: NextResponse } {
  const toDate = toRaw ? new Date(toRaw) : new Date();
  const fromDate = fromRaw
    ? new Date(fromRaw)
    : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (Number.isNaN(toDate.getTime()) || Number.isNaN(fromDate.getTime())) {
    return {
      error: NextResponse.json(
        { error: "from_date and to_date must be valid dates" },
        { status: 400 }
      ),
    };
  }

  if (fromDate > toDate) {
    return {
      error: NextResponse.json(
        { error: "from_date must be before to_date" },
        { status: 400 }
      ),
    };
  }

  return { fromDate, toDate };
}

export function parsePagination(searchParams: URLSearchParams) {
  const rawLimit = Number.parseInt(searchParams.get("limit") ?? "100", 10);
  const rawOffset = Number.parseInt(searchParams.get("offset") ?? "0", 10);

  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 500)
    : 100;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(rawOffset, 0)
    : 0;

  return { limit, offset };
}

export function parseTransactionSort(searchParams: URLSearchParams) {
  const requested = searchParams.get("sort") ?? "transaction_date";
  const sortCol = TRANSACTION_SORT_COLUMNS.has(requested)
    ? requested
    : "transaction_date";
  const ascending = searchParams.get("order") === "asc";

  return { sortCol, ascending };
}

export function sanitizeSearchTerm(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().slice(0, 100);
  if (!trimmed) return null;

  return trimmed.replace(/[,%()]/g, " ");
}
