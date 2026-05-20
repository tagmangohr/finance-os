import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlertItem, FinancialSummary } from "./types";
import { calculateRunway } from "./runway";
import { calculateBurnRate } from "./burn-rate";
import { calculateRevenue } from "./revenue";
import { calculateCollections } from "./collections";
import { calculateConcentration } from "./concentration";
import { calculateCashFlow } from "./cashflow";
import { detectAnomalies } from "./anomalies";
import { calculateTaxPosition } from "./tax-position";
import { generateForecast } from "./forecast";

export async function getFinancialSummary(
  orgId: string,
  supabase: SupabaseClient
): Promise<FinancialSummary> {
  // Run all 9 intelligence functions in parallel
  const [
    runway,
    burnRate,
    revenue,
    collections,
    concentration,
    cashFlow,
    anomalies,
    taxPosition,
    forecast,
  ] = await Promise.all([
    calculateRunway(orgId, supabase),
    calculateBurnRate(orgId, supabase),
    calculateRevenue(orgId, supabase),
    calculateCollections(orgId, supabase),
    calculateConcentration(orgId, supabase),
    calculateCashFlow(orgId, supabase),
    detectAnomalies(orgId, supabase),
    calculateTaxPosition(orgId, supabase),
    generateForecast(orgId, supabase),
  ]);

  // Generate and upsert alerts
  const { alerts, alert_count } = await generateAndUpsertAlerts(orgId, supabase, {
    runway,
    burnRate,
    concentration,
    collections,
    anomalies,
  });

  return {
    generated_at: new Date().toISOString(),
    runway,
    burn_rate: burnRate,
    revenue,
    collections,
    concentration,
    cash_flow: cashFlow,
    anomalies,
    tax_position: taxPosition,
    forecast,
    alerts,
    alert_count,
  };
}

async function generateAndUpsertAlerts(
  orgId: string,
  supabase: SupabaseClient,
  data: {
    runway: Awaited<ReturnType<typeof calculateRunway>>;
    burnRate: Awaited<ReturnType<typeof calculateBurnRate>>;
    concentration: Awaited<ReturnType<typeof calculateConcentration>>;
    collections: Awaited<ReturnType<typeof calculateCollections>>;
    anomalies: Awaited<ReturnType<typeof detectAnomalies>>;
  }
): Promise<{ alerts: AlertItem[]; alert_count: { critical: number; warning: number; info: number } }> {
  type DbAlert = {
    org_id: string;
    type: string;
    severity: "critical" | "warning" | "info";
    title: string;
    message: string;
    data: Record<string, unknown>;
    is_read: boolean;
  };

  function makeAlert(
    type: string,
    severity: "critical" | "warning" | "info",
    title: string,
    message: string,
    extraData: Record<string, unknown> = {}
  ): DbAlert {
    return { org_id: orgId, type, severity, title, message, data: extraData, is_read: false };
  }

  const dbAlerts: DbAlert[] = [];

  // 1. Runway warning
  if (data.runway.severity === "critical") {
    dbAlerts.push(makeAlert(
      "runway_warning", "critical",
      "Critical: Low runway",
      `You have ${data.runway.runway_label} of runway left. Cash will run out around ${data.runway.projected_zero_date}.`,
      { runway_days: data.runway.runway_days, cash_balance: data.runway.cash_balance }
    ));
  } else if (data.runway.severity === "warning") {
    dbAlerts.push(makeAlert(
      "runway_warning", "warning",
      "Runway below 4 months",
      `You have ${data.runway.runway_label} of runway. Start planning to extend it.`,
      { runway_days: data.runway.runway_days }
    ));
  }

  // 2. Burn spike
  if (data.burnRate.change_pct > 25) {
    dbAlerts.push(makeAlert(
      "burn_spike", "warning",
      `Burn up ${data.burnRate.change_pct.toFixed(0)}% MoM`,
      `Your burn rate increased by ${data.burnRate.change_pct.toFixed(0)}% this month. Top driver: ${data.burnRate.top_categories[0]?.category ?? "unknown"}.`,
      {
        current_month: data.burnRate.current_month,
        previous_month: data.burnRate.previous_month,
        change_pct: data.burnRate.change_pct,
      }
    ));
  }

  // 3. Concentration risk
  if (data.concentration.risk_level === "critical" || data.concentration.risk_level === "high") {
    const topCustomer = data.concentration.top_customers[0];
    dbAlerts.push(makeAlert(
      "concentration_risk",
      data.concentration.risk_level === "critical" ? "critical" : "warning",
      `Revenue concentration risk (${data.concentration.risk_level})`,
      topCustomer
        ? `${topCustomer.name} accounts for ${topCustomer.pct.toFixed(0)}% of your revenue. Diversify customer base.`
        : "Revenue is highly concentrated. Diversify customer base.",
      {
        risk_level: data.concentration.risk_level,
        top_customer_pct: topCustomer?.pct,
        hhi: data.concentration.herfindahl_index,
      }
    ));
  }

  // 4. Collections overdue
  if (data.collections.overdue_90_plus > 0) {
    dbAlerts.push(makeAlert(
      "collection_overdue", "warning",
      "Invoices 90+ days overdue",
      `₹${data.collections.overdue_90_plus.toLocaleString("en-IN")} has been outstanding for over 90 days. Risk of bad debt.`,
      {
        amount_90_plus: data.collections.overdue_90_plus,
        total_outstanding: data.collections.total_outstanding,
      }
    ));
  }

  // 5. High severity anomalies
  const highAnomalies = data.anomalies.anomalies.filter((a) => a.severity === "high");
  if (highAnomalies.length > 0) {
    dbAlerts.push(makeAlert(
      "anomaly", "warning",
      `${highAnomalies.length} unusual transaction${highAnomalies.length > 1 ? "s" : ""} detected`,
      `${highAnomalies[0].description}: ${highAnomalies[0].reason}`,
      { anomalies: highAnomalies.slice(0, 3) }
    ));
  }

  // Upsert alerts — clear today's alerts first, then insert fresh ones
  const today = new Date().toISOString().split("T")[0];
  if (dbAlerts.length > 0) {
    await supabase
      .from("intelligence_alerts")
      .delete()
      .eq("org_id", orgId)
      .gte("created_at", `${today}T00:00:00`);

    await supabase.from("intelligence_alerts").insert(dbAlerts);
  }

  const alerts: AlertItem[] = dbAlerts.map((a) => ({
    type: a.type,
    severity: a.severity,
    message: a.message,
  }));

  return {
    alerts,
    alert_count: {
      critical: dbAlerts.filter((a) => a.severity === "critical").length,
      warning: dbAlerts.filter((a) => a.severity === "warning").length,
      info: dbAlerts.filter((a) => a.severity === "info").length,
    },
  };
}

export { type FinancialSummary };
