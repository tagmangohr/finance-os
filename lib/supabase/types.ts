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
          type: "razorpay" | "stripe" | "zoho" | "quickbooks" | "tally" | "csv" | "bank_statement" | "cashfree" | "payu" | "paytm" | "easebuzz";
          name: string;
          status: "active" | "inactive" | "error";
          config: Json;
          last_synced_at: string | null;
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
    };
  };
}

// Convenience type aliases
export type Organization = Database["public"]["Tables"]["organizations"]["Row"];
export type Connector = Database["public"]["Tables"]["connectors"]["Row"];
export type Transaction = Database["public"]["Tables"]["transactions"]["Row"];
export type Entity = Database["public"]["Tables"]["entities"]["Row"];
export type FinancialSnapshot = Database["public"]["Tables"]["financial_snapshots"]["Row"];
export type IntelligenceAlert = Database["public"]["Tables"]["intelligence_alerts"]["Row"];
export type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
