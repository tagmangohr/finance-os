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
          type: "razorpay" | "stripe" | "zoho" | "quickbooks" | "tally" | "csv" | "bank_statement" | "cashfree" | "payu" | "paytm" | "easebuzz" | "google_drive" | "onedrive" | "google_sheets" | "excel" | "app_store";
          name: string;
          status: "active" | "inactive" | "error";
          config: Json;
          last_synced_at: string | null;
          synced_through: string | null;
          events_synced_through: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["connectors"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["connectors"]["Insert"]>;
      };
      webhook_events: {
        Row: {
          id: string;
          received_at: string;
          provider: string;
          event_type: string | null;
          signature_ok: boolean;
          outcome: "missing_headers" | "signature_failed" | "bad_json" | "ignored" | "persisted" | "persist_error" | "unmatched";
          connector_id: string | null;
          org_id: string | null;
          external_id: string | null;
          order_id: string | null;
          amount: number | null;
          status: string | null;
          error: string | null;
          payload: Json | null;
        };
        Insert: Omit<Database["public"]["Tables"]["webhook_events"]["Row"], "id" | "received_at"> & { received_at?: string };
        Update: Partial<Database["public"]["Tables"]["webhook_events"]["Insert"]>;
      };
      cashfree_subscriptions: {
        Row: {
          subscription_id: string;
          connector_id: string;
          org_id: string;
          status: string | null;
          plan_name: string | null;
          plan_amount: number | null;
          currency: string | null;
          customer_name: string | null;
          customer_email: string | null;
          customer_phone: string | null;
          first_charge_at: string | null;
          next_charge_at: string | null;
          last_event_type: string | null;
          last_event_at: string | null;
          last_polled_at: string | null;
          raw: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["cashfree_subscriptions"]["Row"], "created_at" | "updated_at"> & { created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["cashfree_subscriptions"]["Insert"]>;
      };
      subscriptions: {
        Row: {
          id: string;
          org_id: string;
          connector_id: string | null;
          gateway: string;
          subscription_id: string;
          customer_name: string | null;
          customer_email: string | null;
          customer_phone: string | null;
          customer_gateway_id: string | null;
          plan_id: string | null;
          plan_name: string | null;
          plan_amount: number | null;
          currency: string | null;
          amount_base: number | null;
          billing_interval: string | null;
          interval_count: number | null;
          status: string | null;
          native_status: string | null;
          auto_renew: boolean | null;
          cancel_at_period_end: boolean | null;
          cancel_reason: string | null;
          started_at: string | null;
          trial_start: string | null;
          trial_end: string | null;
          current_period_start: string | null;
          current_period_end: string | null;
          next_charge_at: string | null;
          cancel_requested_at: string | null;
          ended_at: string | null;
          total_cycles: number | null;
          paid_count: number | null;
          remaining_count: number | null;
          payment_method: string | null;
          mandate_status: string | null;
          card_last4: string | null;
          card_expiry: string | null;
          first_seen_at: string;
          last_event_type: string | null;
          last_event_at: string | null;
          last_synced_at: string | null;
          raw: Json | null;
          created_at: string;
          updated_at: string;
        };
        // Only the natural key is required; every other field is optional (nullable,
        // filled progressively as events/pulls enrich the row).
        Insert: { org_id: string; gateway: string; subscription_id: string } & Partial<
          Omit<Database["public"]["Tables"]["subscriptions"]["Row"], "org_id" | "gateway" | "subscription_id">
        >;
        Update: Partial<Database["public"]["Tables"]["subscriptions"]["Row"]>;
      };
      subscription_events: {
        Row: {
          id: string;
          org_id: string;
          gateway: string;
          subscription_id: string;
          event_type: string;
          native_event_type: string | null;
          event_at: string;
          amount: number | null;
          currency: string | null;
          amount_base: number | null;
          transaction_external_id: string | null;
          event_ref: string | null;
          raw: Json | null;
          created_at: string;
        };
        Insert: { org_id: string; gateway: string; subscription_id: string; event_type: string; event_at: string } & Partial<
          Omit<Database["public"]["Tables"]["subscription_events"]["Row"], "org_id" | "gateway" | "subscription_id" | "event_type" | "event_at">
        >;
        Update: Partial<Database["public"]["Tables"]["subscription_events"]["Row"]>;
      };
      user_metric_prefs: {
        Row: {
          user_id: string;
          org_id: string;
          pinned_metric_keys: string[];
          visible_count: number;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["user_metric_prefs"]["Row"], "updated_at"> & { updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["user_metric_prefs"]["Insert"]>;
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
          amount_base: number | null;
          base_currency: string | null;
          fx_rate: number | null;
          category: string | null;
          category_confidence: number | null;
          counterparty_id: string | null;
          counterparty_name: string | null;
          description: string | null;
          source: string;
          status: "pending" | "completed" | "failed" | "refunded";
          transaction_date: string;
          transaction_at: string | null;
          // Non-null only for recurring/subscription charges (the gateway subscription
          // id). Never written by the recon/one-time refresh path, so it's durable.
          subscription_id: string | null;
          metadata: Json;
          // Full unmodified source payload. `has_raw` is a generated column
          // (raw IS NOT NULL) — never written directly, only read.
          raw: Json | null;
          has_raw: boolean;
          created_at: string;
        };
        // New multi-currency columns + transaction_at + raw + subscription_id are
        // optional on insert (nullable, filled by the sync layer) so existing
        // inserters don't break. has_raw is generated → omitted from Insert entirely.
        Insert: Omit<Database["public"]["Tables"]["transactions"]["Row"], "id" | "created_at" | "amount_base" | "base_currency" | "fx_rate" | "transaction_at" | "subscription_id" | "raw" | "has_raw"> & Partial<Pick<Database["public"]["Tables"]["transactions"]["Row"], "amount_base" | "base_currency" | "fx_rate" | "transaction_at" | "subscription_id" | "raw">>;
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
          stream: string | null;
          cursor: string | null;
          processed: number;
          advance_checkpoint: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["sync_jobs"]["Row"], "id" | "created_at" | "updated_at" | "status" | "attempts" | "max_attempts" | "run_after" | "locked_at" | "locked_by" | "last_error" | "result" | "stream" | "cursor" | "processed" | "advance_checkpoint"> & Partial<Pick<Database["public"]["Tables"]["sync_jobs"]["Row"], "status" | "attempts" | "max_attempts" | "run_after" | "stream" | "cursor" | "processed" | "advance_checkpoint">>;
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
