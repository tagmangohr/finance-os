// ============================================================
// Intelligence layer result types — Finance OS
// ============================================================

export interface RunwayResult {
  cash_balance: number;
  burn_rate: number;
  runway_days: number;
  runway_label: string;
  severity: 'critical' | 'warning' | 'good';
  projected_zero_date: string;
}

export interface BurnRateResult {
  current_month: number;
  previous_month: number;
  change_pct: number;
  top_categories: { category: string; amount: number; pct: number }[];
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface RevenueResult {
  mrr: number;
  arr: number;
  mom_growth: number;
  yoy_growth: number;
  total_ytd: number;
  by_month: { month: string; amount: number }[];
}

export interface CollectionsResult {
  total_outstanding: number;
  overdue_0_30: number;
  overdue_31_60: number;
  overdue_61_90: number;
  overdue_90_plus: number;
  collection_rate: number;
  top_debtors: {
    entity_id: string;
    name: string;
    amount: number;
    days_overdue: number;
  }[];
}

export interface ConcentrationResult {
  top_customers: {
    entity_id: string;
    name: string;
    revenue: number;
    pct: number;
  }[];
  herfindahl_index: number;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
}

export interface CashFlowResult {
  inflows_30d: number;
  outflows_30d: number;
  net_30d: number;
  forecast_30d: number;
  forecast_60d: number;
  forecast_90d: number;
  daily_data: {
    date: string;
    inflow: number;
    outflow: number;
    balance: number;
  }[];
}

export interface AnomalyResult {
  anomalies: {
    transaction_id: string;
    amount: number;
    description: string;
    reason: string;
    severity: 'high' | 'medium' | 'low';
    date: string;
  }[];
}

export interface TaxPositionResult {
  gst_liability_estimate: number;
  tds_deducted: number;
  advance_tax_estimate: number;
  next_due_date: string;
  notes: string;
}

export interface ForecastResult {
  revenue_next_month: number;
  revenue_next_quarter: number;
  confidence: number;
  growth_rate: number;
  assumptions: string[];
}

export interface AlertItem {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
}

export interface FinancialSummary {
  runway: RunwayResult;
  burn_rate: BurnRateResult;
  revenue: RevenueResult;
  collections: CollectionsResult;
  concentration: ConcentrationResult;
  cash_flow: CashFlowResult;
  anomalies: AnomalyResult;
  tax_position: TaxPositionResult;
  forecast: ForecastResult;
  alerts: AlertItem[];
  alert_count: { critical: number; warning: number; info: number };
  generated_at: string;
}
