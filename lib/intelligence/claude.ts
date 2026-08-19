import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFinancialSummary } from "./index";
import { formatCurrency, formatDate, formatRunway } from "@/lib/utils";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const client = new Anthropic();

async function buildFinancialContext(
  orgId: string,
  supabase: SupabaseClient
): Promise<string> {
  const summary = await getFinancialSummary(orgId, supabase);

  const lines: string[] = [
    "=== CURRENT FINANCIAL STATE ===",
    "",
    `Cash & Runway:`,
    `  Cash Balance: ${formatCurrency(summary.runway.cash_balance)}`,
    `  Monthly Burn: ${formatCurrency(summary.burn_rate.current_month)}`,
    `  Runway: ${formatRunway(summary.runway.runway_days)} (${summary.runway.severity} zone)`,
    `  Projected Cash Zero: ${summary.runway.projected_zero_date}`,
    "",
    `Revenue:`,
    `  MRR: ${formatCurrency(summary.revenue.mrr)}`,
    `  ARR: ${formatCurrency(summary.revenue.arr)}`,
    `  MoM Growth: ${summary.revenue.mom_growth.toFixed(1)}%`,
    `  YTD Revenue: ${formatCurrency(summary.revenue.total_ytd)}`,
    "",
    `Burn Rate (this month vs last month):`,
    `  This Month: ${formatCurrency(summary.burn_rate.current_month)}`,
    `  Last Month: ${formatCurrency(summary.burn_rate.previous_month)}`,
    `  Change: ${summary.burn_rate.change_pct.toFixed(1)}% (${summary.burn_rate.trend})`,
    `  Top spend categories: ${summary.burn_rate.top_categories.slice(0, 3).map(c => `${c.category} ${formatCurrency(c.amount)} (${c.pct.toFixed(0)}%)`).join(", ")}`,
    "",
    `Collections (Accounts Receivable):`,
    `  Total Outstanding: ${formatCurrency(summary.collections.total_outstanding)}`,
    `  0-30 days: ${formatCurrency(summary.collections.overdue_0_30)}`,
    `  31-60 days: ${formatCurrency(summary.collections.overdue_31_60)}`,
    `  61-90 days: ${formatCurrency(summary.collections.overdue_61_90)}`,
    `  90+ days: ${formatCurrency(summary.collections.overdue_90_plus)}`,
    `  Collection Rate: ${summary.collections.collection_rate.toFixed(1)}%`,
  ];

  if (summary.collections.top_debtors.length > 0) {
    lines.push(`  Top debtors:`);
    summary.collections.top_debtors.slice(0, 3).forEach((d) => {
      lines.push(`    - ${d.name}: ${formatCurrency(d.amount)} (${d.days_overdue}d overdue)`);
    });
  }

  lines.push(
    "",
    `Revenue Concentration:`,
    `  Risk Level: ${summary.concentration.risk_level.toUpperCase()}`,
    `  HHI: ${summary.concentration.herfindahl_index.toFixed(3)}`,
  );

  if (summary.concentration.top_customers.length > 0) {
    lines.push(`  Top customers:`);
    summary.concentration.top_customers.slice(0, 3).forEach((c) => {
      lines.push(`    - ${c.name}: ${formatCurrency(c.revenue)} (${c.pct.toFixed(1)}% of revenue)`);
    });
  }

  lines.push(
    "",
    `Cash Flow (30 days):`,
    `  Inflows: ${formatCurrency(summary.cash_flow.inflows_30d)}`,
    `  Outflows: ${formatCurrency(summary.cash_flow.outflows_30d)}`,
    `  Net: ${formatCurrency(summary.cash_flow.net_30d)}`,
    `  Forecast 30d: ${formatCurrency(summary.cash_flow.forecast_30d)}`,
    `  Forecast 90d: ${formatCurrency(summary.cash_flow.forecast_90d)}`,
    "",
    `Tax Position (estimates):`,
    `  GST Liability (quarter): ${formatCurrency(summary.tax_position.gst_liability_estimate)}`,
    `  Next GST Due: ${summary.tax_position.next_due_date}`,
    "",
    `Revenue Forecast:`,
    `  Next Month: ${formatCurrency(summary.forecast.revenue_next_month)}`,
    `  Next Quarter: ${formatCurrency(summary.forecast.revenue_next_quarter)}`,
    `  Confidence: ${(summary.forecast.confidence * 100).toFixed(0)}%`,
  );

  if (summary.anomalies.anomalies.length > 0) {
    lines.push(``, `Anomalies detected (${summary.anomalies.anomalies.length}):`);
    summary.anomalies.anomalies.slice(0, 3).forEach((a) => {
      lines.push(`  - [${a.severity.toUpperCase()}] ${a.description}: ${formatCurrency(a.amount)} — ${a.reason}`);
    });
  }

  lines.push(
    "",
    `Active Alerts: ${summary.alert_count.critical} critical, ${summary.alert_count.warning} warnings, ${summary.alert_count.info} info`,
    "",
    `Data as of: ${formatDate(summary.generated_at)}`,
  );

  return lines.join("\n");
}

export async function askFinancialQuestion(
  orgId: string,
  question: string,
  history: ChatMessage[],
  supabase: SupabaseClient
): Promise<string> {
  const context = await buildFinancialContext(orgId, supabase);

  const systemPrompt = `You are a senior CFO and financial advisor embedded in Finance OS — an intelligence platform built for founders and MSMEs.

You have real-time access to the company's financial data (provided below). Your job is to give the founder direct, actionable answers — not accountant jargon.

Rules:
- Use ₹ for INR amounts, $ for USD
- Be direct and prescriptive: say "You should collect from X now" not "It may be worth considering collecting from X"
- Reference exact numbers from the data, not vague statements
- Keep answers concise (under 200 words unless detailed analysis is asked for)
- If something is urgent or risky, be clear about it
- Format: use line breaks for readability, bold for key numbers (using **bold**)
- Never make up numbers not in the data
- If you don't have enough data to answer confidently, say so and explain what data would help

FINANCIAL DATA:
${context}`;

  // Keep last 10 messages for context
  const recentHistory = history.slice(-10);

  const messages = recentHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      ...messages,
      { role: "user", content: question },
    ],
  });

  const content = response.content[0];
  if (content.type !== "text") return "I couldn't generate a response. Please try again.";

  return content.text;
}
