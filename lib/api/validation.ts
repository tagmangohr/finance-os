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
  "google_drive",
  "onedrive",
  "google_sheets",
  "excel",
  "app_store",
] as const;

export const CONNECTOR_STATUSES = ["active", "inactive", "error"] as const;

const TRANSACTION_SORT_COLUMNS = new Set([
  "transaction_date",
  "transaction_at",
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

/**
 * Validate a connector's credential config by type. Returns a human-readable
 * error string, or null when valid. Field names match what lib/connectors/sync.ts
 * reads. Catches the common "wrong key pasted" mistake (e.g. a Stripe publishable
 * key, or an unrelated token, in the secret-key field) BEFORE it's saved, so a
 * bad key can never silently fail every sync call later.
 */
export function validateConnectorConfig(
  type: string,
  config: Record<string, unknown>
): string | null {
  const get = (k: string) => (typeof config[k] === "string" ? (config[k] as string).trim() : "");

  switch (type) {
    case "stripe": {
      const key = get("secret_key");
      if (!key) return "Enter your Stripe Secret key.";
      if (!/^(sk|rk)_(live|test)_/.test(key)) {
        return "That doesn't look like a Stripe secret key. Copy the Secret key from Stripe → Developers → API keys — it starts with sk_live_, sk_test_, or rk_live_ (not pk_ or a publishable key).";
      }
      return null;
    }
    case "razorpay": {
      const id = get("key_id");
      if (!id || !get("key_secret")) return "Razorpay needs both a Key ID and a Key Secret.";
      if (!/^rzp_(live|test)_/.test(id)) return "Razorpay Key ID should start with rzp_live_ or rzp_test_.";
      return null;
    }
    case "cashfree":
      if (!get("client_id") || !get("client_secret")) return "Cashfree needs a Client ID and Client Secret.";
      return null;
    case "payu":
      if (!get("key") || !get("salt")) return "PayU needs a Merchant Key and Salt.";
      return null;
    case "easebuzz":
      if (!get("key") || !get("salt")) return "Easebuzz needs a Merchant Key and Salt.";
      return null;
    case "paytm":
      if (!get("merchant_id") || !get("merchant_key")) return "Paytm needs a Merchant ID and Merchant Key.";
      return null;
    case "google_sheets": {
      const url = get("sheet_url");
      if (!url) return "Paste your Google Sheet link.";
      if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(url)) {
        return "That doesn't look like a Google Sheet link. Copy it from the browser address bar — it starts with https://docs.google.com/spreadsheets/d/. The sheet must be shared as 'Anyone with the link can view'.";
      }
      return null;
    }
    case "excel": {
      const url = get("file_url");
      if (!url) return "Paste a public link to your Excel file.";
      if (!/^https:\/\//.test(url)) return "The Excel link must be a public https URL (Google Drive, OneDrive, or a direct .xlsx link).";
      return null;
    }
    case "app_store": {
      // No secret: App Store Server Notifications are verified via Apple's cert
      // chain, not a shared key. We only need the app's bundle id to route
      // notifications to this connector; app_apple_id is recommended (required by
      // Apple to verify Production notifications) but optional here.
      const bundleId = get("bundle_id");
      if (!bundleId) return "Enter your app's Bundle ID (e.g. com.yourcompany.app) from App Store Connect.";
      if (!/^[A-Za-z0-9][A-Za-z0-9.\-]+$/.test(bundleId)) return "That doesn't look like a Bundle ID. It's a reverse-DNS string like com.yourcompany.app.";
      const appId = get("app_apple_id");
      if (appId && !/^\d+$/.test(appId)) return "Apple App ID (appAppleId) must be numeric — find it in App Store Connect → App Information.";
      return null;
    }
    default:
      // csv, bank_statement, accounting tools, drive connectors: no key check here.
      return null;
  }
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
