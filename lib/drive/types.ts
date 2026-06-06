// ─── Drive provider ───────────────────────────────────────────────────────────

export type DriveProvider = "google_drive" | "onedrive";

// ─── Column mapping ───────────────────────────────────────────────────────────
// Stored as JSONB in drive_files.column_mapping.
// Each field is the *source column name* from the spreadsheet header row,
// or null / undefined if not mapped.

export type DriveColumnMapping = {
  /** Column containing transaction date */
  date: string | null;
  /** Single amount column (positive = credit, negative = debit) */
  amount: string | null;
  /** Separate debit-only column (mutually exclusive with amount+type pattern) */
  debit: string | null;
  /** Separate credit-only column (mutually exclusive with amount+type pattern) */
  credit: string | null;
  /** Column that signals transaction direction: e.g. "DR"/"CR", "debit"/"credit" */
  type: string | null;
  /** Human-readable description / narration */
  description: string | null;
  /** Counterparty / payee / beneficiary name */
  counterparty: string | null;
  /** Currency code column (defaults to org currency if absent) */
  currency: string | null;
  /** Reference / transaction ID column — used to build a stable external_id */
  reference: string | null;
};

export const EMPTY_MAPPING: DriveColumnMapping = {
  date: null,
  amount: null,
  debit: null,
  credit: null,
  type: null,
  description: null,
  counterparty: null,
  currency: null,
  reference: null,
};

// ─── Spreadsheet file info returned from provider API ─────────────────────────

export type DriveFileInfo = {
  id: string;
  name: string;
  mimeType: string;
  /** Provider-specific etag/version string for change detection */
  etag: string | null;
  modifiedAt: string | null;
};

// ─── DB row shapes (typed for use outside Supabase generated types) ───────────

export type DriveConnection = {
  id: string;
  org_id: string;
  connector_id: string;
  provider: DriveProvider;
  access_token: string;
  refresh_token: string | null;
  token_expiry: string | null;
  account_email: string | null;
  account_name: string | null;
  created_at: string;
  updated_at: string;
};

export type DriveFolder = {
  id: string;
  org_id: string;
  connection_id: string;
  provider_folder_id: string;
  folder_name: string;
  folder_url: string;
  last_scan_at: string | null;
  created_at: string;
};

export type DriveFile = {
  id: string;
  org_id: string;
  folder_id: string;
  provider_file_id: string;
  file_name: string;
  mime_type: string | null;
  column_mapping: DriveColumnMapping | null;
  mapping_confirmed: boolean;
  last_etag: string | null;
  last_modified_at: string | null;
  row_count: number | null;
  last_sync_at: string | null;
  created_at: string;
};

// ─── Composite types for UI ───────────────────────────────────────────────────

export type DriveFolderWithFiles = DriveFolder & { drive_files: DriveFile[] };

export type DriveConnectionWithFolders = DriveConnection & {
  drive_folders: DriveFolderWithFiles[];
};

// ─── Column target fields (for the mapping UI dropdowns) ─────────────────────

export const MAPPING_TARGET_OPTIONS = [
  { value: "",            label: "— Ignore —" },
  { value: "date",        label: "Transaction Date" },
  { value: "amount",      label: "Amount (+ = credit, − = debit)" },
  { value: "debit",       label: "Debit Amount" },
  { value: "credit",      label: "Credit Amount" },
  { value: "type",        label: "Type (DR/CR indicator)" },
  { value: "description", label: "Description / Narration" },
  { value: "counterparty",label: "Counterparty / Payee" },
  { value: "currency",    label: "Currency Code" },
  { value: "reference",   label: "Reference / Transaction ID" },
] as const;

export type MappingTargetValue = typeof MAPPING_TARGET_OPTIONS[number]["value"];
