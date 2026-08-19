import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFinancialSummaryForOrg } from "@/lib/data";
import { formatCurrency, formatDate, formatRunway } from "@/lib/utils";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const client = new Anthropic();

async function buildFinancialContext(orgId: string): Promise<string> {
  // Use the fast, rollup + snapshot-based summary (same path as the dashboard) so
  // the co-pilot never recomputes the heavy intelligence suite live — that scanned
  // the raw transactions table on every question and hit Postgres statement timeouts.
  const s = await getFinancialSummaryForOrg(orgId);

  if (!s.hasData) {
    return "No financial data is connected for this organisation yet, so there are no numbers to analyse.";
  }

  const year = new Date().getFullYear().toString();
  const ytd = s.revenueByMonth
    .filter((m) => m.month.startsWith(year))
    .reduce((sum, m) => sum + m.amount, 0);

  const cf = s.cashFlowData ?? [];
  const inflow = cf.reduce((a, d) => a + (d.inflow || 0), 0);
  const outflow = cf.reduce((a, d) => a + (d.outflow || 0), 0);

  const lines: string[] = [
    "=== CURRENT FINANCIAL STATE ===",
    "",
    "Cash & Runway:",
    `  Cash Balance: ${formatCurrency(s.cashBalance)}`,
    `  Monthly Burn: ${formatCurrency(s.burnRate)}`,
    `  Runway: ${formatRunway(s.runwayDays)}`,
    "",
    "Revenue:",
    `  MRR: ${formatCurrency(s.mrr)}`,
    `  ARR: ${formatCurrency(s.arr)}`,
    `  MoM Growth: ${s.mrrGrowth.toFixed(1)}%`,
    `  YTD Revenue: ${formatCurrency(ytd)}`,
    "",
    "Burn:",
    `  This Month: ${formatCurrency(s.burnRate)}`,
    `  MoM Change: ${s.burnChange.toFixed(1)}%`,
  ];

  if (s.categoryBreakdown.length > 0) {
    lines.push(
      `  Top spend categories: ${s.categoryBreakdown
        .slice(0, 3)
        .map((c) => `${c.category} ${formatCurrency(c.amount)} (${c.pct.toFixed(0)}%)`)
        .join(", ")}`
    );
  }

  if (s.snapshot) {
    lines.push(
      "",
      "Collections (Accounts Receivable):",
      `  Total Outstanding: ${formatCurrency(s.snapshot.accounts_receivable)}`,
      `  Collection Rate: ${s.snapshot.collection_rate.toFixed(1)}%`
    );
  }

  if (s.topDebtors.length > 0) {
    lines.push("  Top debtors:");
    s.topDebtors.slice(0, 5).forEach((d) => {
      lines.push(`    - ${d.name}: ${formatCurrency(d.outstanding_amount)}`);
    });
  }

  if (cf.length > 0) {
    lines.push(
      "",
      `Cash Flow (recent ${cf.length} days):`,
      `  Inflows: ${formatCurrency(inflow)}`,
      `  Outflows: ${formatCurrency(outflow)}`,
      `  Net: ${formatCurrency(inflow - outflow)}`
    );
  }

  if (s.revenueByMonth.length > 0) {
    lines.push("", "Revenue by month (recent):");
    s.revenueByMonth.slice(-6).forEach((m) => lines.push(`  ${m.month}: ${formatCurrency(m.amount)}`));
  }

  if (s.alerts.length > 0) {
    lines.push("", `Active Alerts (${s.alerts.length}):`);
    s.alerts.slice(0, 5).forEach((a) => lines.push(`  - [${a.severity.toUpperCase()}] ${a.title}`));
  }

  lines.push(
    "",
    `Data as of: ${formatDate(s.snapshot?.snapshot_date ?? new Date().toISOString())}`
  );

  return lines.join("\n");
}

export async function askFinancialQuestion(
  orgId: string,
  question: string,
  history: ChatMessage[],
  supabase: SupabaseClient
): Promise<string> {
  const context = await buildFinancialContext(orgId);

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
