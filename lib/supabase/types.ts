export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          currency: string;
          timezone: string;
          owner_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["organizations"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["organizations"]["Insert"]>;
      };
      connectors: {
        Row: {
          id: string;
          org_id: string;
          type: "razorpay" | "stripe" | "zoho" | "quickbooks" | "tally" | "csv" | "bank_statement" | "cashfree" | "payu" | "paytm" | "easebuzz" | "google_drive" | "onedrive";
          name: string;
          status: "active" | "inactive" | "error";
          config: Json;
          last_synced_at: string | null;
          synced_through: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["connectors"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["connectors"]["Insert"]>;
      };
      transactions: {
        Row: {
          id: string;
          org_id: string;
          connector_id: string;
          external_id: string | null;
          type: "credit" | "debit";
          amount: number;
          currency: string;
          category: string | null;
          category_confidence: number | null;
          counterparty_id: string | null;
          counterparty_name: string | null;
          description: string | null;
          source: string;
          status: "pending" | "completed" | "failed" | "refunded";
          transaction_date: string;
          metadata: Json;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["transactions"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["transactions"]["Insert"]>;
      };
      entities: {
        Row: {
          id: string;
          org_id: string;
          type: "customer" | "vendor";
          name: string;
          email: string | null;
          phone: string | null;
          gstin: string | null;
          total_revenue: number;
          total_paid: number;
          outstanding_amount: number;
          last_transaction_date: string | null;
          avg_payment_days: number | null;
          risk_score: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["entities"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["entities"]["Insert"]>;
      };
      financial_snapshots: {
        Row: {
          id: string;
          org_id: string;
          snapshot_date: string;
          cash_balance: number;
          total_revenue_mtd: number;
          total_expenses_mtd: number;
          burn_rate: number;
          runway_days: number;
          mrr: number;
          arr: number;
          accounts_receivable: number;
          accounts_payable: number;
          collection_rate: number;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["financial_snapshots"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["financial_snapshots"]["Insert"]>;
      };
      intelligence_alerts: {
        Row: {
          id: string;
          org_id: string;
          type: "runway_warning" | "collection_overdue" | "burn_spike" | "concentration_risk" | "anomaly" | "tax_due" | "forecast";
          severity: "critical" | "warning" | "info";
          title: string;
          message: string;
          data: Json;
          is_read: boolean;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["intelligence_alerts"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["intelligence_alerts"]["Insert"]>;
      };
      invoices: {
        Row: {
          id: string;
          org_id: string;
          entity_id: string;
          external_id: string | null;
          invoice_number: string;
          amount: number;
          currency: string;
          status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
          due_date: string;
          paid_date: string | null;
          line_items: Json;
          connector_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["invoices"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["invoices"]["Insert"]>;
      };
      sync_jobs: {
        Row: {
          id: string;
          org_id: string;
          connector_id: string;
          type: string;
          window_from: string;
          window_to: string;
          status: "pending" | "running" | "done" | "failed";
          attempts: number;
          max_attempts: number;
          run_after: string;
          locked_at: string | null;
          locked_by: string | null;
          last_error: string | null;
          result: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["sync_jobs"]["Row"], "id" | "created_at" | "updated_at" | "status" | "attempts" | "max_attempts" | "run_after" | "locked_at" | "locked_by" | "last_error" | "result"> & Partial<Pick<Database["public"]["Tables"]["sync_jobs"]["Row"], "status" | "attempts" | "max_attempts" | "run_after">>;
        Update: Partial<Database["public"]["Tables"]["sync_jobs"]["Row"]>;
      };
    };
    Functions: {
      claim_sync_jobs: {
        Args: { p_batch: number; p_worker: string };
        Returns: Database["public"]["Tables"]["sync_jobs"]["Row"][];
      };
    };
  };
}

export type SyncJobRow = Database["public"]["Tables"]["sync_jobs"]["Row"];

// ─── Drive connector table types ─────────────────────────────────────────────

export interface DriveConnectionRow {
  id:            string;
  org_id:        string;
  connector_id:  string;
  provider:      "google_drive" | "onedrive";
  access_token:  string;
  refresh_token: string | null;
  token_expiry:  string | null;
  account_email: string | null;
  account_name:  string | null;
  created_at:    string;
  updated_at:    string;
}

export interface DriveFolderRow {
  id:                 string;
  org_id:             string;
  connection_id:      string;
  provider_folder_id: string;
  folder_name:        string;
  folder_url:         string;
  last_scan_at:       string | null;
  created_at:         string;
}

export interface DriveFileRow {
  id:               string;
  org_id:           string;
  folder_id:        string;
  provider_file_id: string;
  file_name:        string;
  mime_type:        string | null;
  column_mapping:   Json | null;
  mapping_confirmed:boolean;
  last_etag:        string | null;
  last_modified_at: string | null;
  row_count:        number | null;
  last_sync_at:     string | null;
  created_at:       string;
}

// ─── Convenience type aliases ─────────────────────────────────────────────────

export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type Connector = Database["public"]["Tables"]["connectors"]["Row"];
export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
export type Entity = Database["public"]["Tables"]["entities"]["Row"];
export type FinancialSnapshot = Database["public"]["Tables"]["financial_snapshots"]["Row"];
export type IntelligenceAlert = Database["public"]["Tables"]["intelligence_alerts"]["Row"];
export type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
