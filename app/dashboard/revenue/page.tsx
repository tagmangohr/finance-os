export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { getOrgId, getRevenueDetails } from "@/lib/data";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatPercent } from "@/lib/utils";
import { format } from "date-fns";

// ── Shared card shell ────────────────────────────────────────────────
function Panel({ title, subtitle, action, children }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-border overflow-hidden transition-all duration-200 hover:border-border"
      style={{ background: "hsl(var(--card))" }}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-0">
        <div>
          <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">{title}</p>
          {subtitle && <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="px-4 pb-4 pt-2">{children}</div>
    </div>
  );
}

export default async function RevenuePage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const { revenueByMonth, customers, mrrTrend, mrr, arr, momGrowth, yoyGrowth } =
    await getRevenueDetails(orgId);

  const totalRevenue = customers.reduce((s, c) => s + c.total_revenue, 0);

  return (
    <div className="space-y-3 max-w-[1400px]">

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="animate-enter">
        <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-muted-foreground/70 mb-0.5">Finance OS</p>
        <h1 className="text-[22px] font-bold tracking-tight text-foreground leading-none">Revenue</h1>
      </div>

      {/* ── 4 metric cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter-delay-1">
        <MetricCard
          title="MRR"
          value={formatCurrency(mrr, "INR", true)}
          subtitle="Monthly Recurring Revenue"
          trend={momGrowth !== 0 ? momGrowth : undefined}
          trendLabel="MoM"
          severity={mrr > 0 ? "good" : "neutral"}
        />
        <MetricCard
          title="ARR"
          value={formatCurrency(arr, "INR", true)}
          subtitle="Annual Run Rate"
          severity={arr > 0 ? "good" : "neutral"}
        />
        <MetricCard
          title="MoM Growth"
          value={formatPercent(momGrowth)}
          subtitle="vs last month"
          severity={momGrowth >= 0 ? "good" : "warning"}
        />
        <MetricCard
          title="YoY Growth"
          value={formatPercent(yoyGrowth)}
          subtitle="vs same month last year"
          severity={yoyGrowth >= 0 ? "good" : "warning"}
        />
      </div>

      {/* ── Full-width bar chart ──────────────────────────────────────── */}
      <Panel title="Revenue" subtitle="last 12 months">
        {revenueByMonth.length > 0 ? (
          <RevenueChart data={revenueByMonth} height={280} />
        ) : (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <TrendingUp className="h-7 w-7 text-muted-foreground/70" />
            <p className="text-[13px] text-muted-foreground/70">No revenue data yet.</p>
            <Button variant="link" asChild className="text-primary/60 hover:text-primary h-auto p-0">
              <Link href="/dashboard/connectors">Connect a data source →</Link>
            </Button>
          </div>
        )}
      </Panel>

      {/* ── Two columns: customer table + MRR trend ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 animate-enter-delay-2">

        {/* Customer revenue breakdown */}
        <Panel title="Revenue by Customer">
          {customers.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[13px] text-muted-foreground/70">
              No customer data yet
            </div>
          ) : (
            <div className="overflow-x-auto mt-1">
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    <th className="text-left pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70">Customer</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70">Revenue</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70 hidden sm:table-cell">Share</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70 hidden md:table-cell">Last Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const pct = totalRevenue > 0 ? (customer.total_revenue / totalRevenue) * 100 : 0;
                    const isHighConc = pct > 30;
                    return (
                      <tr key={customer.id} className="border-t border-border group">
                        <td className="py-2.5 font-medium text-muted-foreground max-w-[140px] truncate group-hover:text-foreground transition-colors">
                          {customer.name}
                        </td>
                        <td className="py-2.5 text-right num text-muted-foreground font-semibold">
                          {formatCurrency(customer.total_revenue, "INR", true)}
                        </td>
                        <td className="py-2.5 text-right hidden sm:table-cell">
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold"
                            style={isHighConc
                              ? { background: "rgba(245,145,22,0.12)", color: "#f59116" }
                              : { background: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }
                            }
                          >
                            {pct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground/70 hidden md:table-cell">
                          {customer.last_transaction_date ? formatDate(customer.last_transaction_date) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Concentration bars */}
              <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                {customers.slice(0, 5).map((customer) => {
                  const pct = totalRevenue > 0 ? (customer.total_revenue / totalRevenue) * 100 : 0;
                  return (
                    <div key={customer.id} className="flex items-center gap-2.5">
                      <span className="text-[10.5px] text-muted-foreground/70 w-28 truncate flex-shrink-0">{customer.name}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-accent/40 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            background: pct > 30 ? "#f59116" : "#7c52f0",
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <span className="num text-[10.5px] text-muted-foreground w-9 text-right flex-shrink-0">{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>

        {/* MRR trend table */}
        <Panel title="MRR Trend">
          {mrrTrend.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-[13px] text-muted-foreground/70">
              No MRR history yet
            </div>
          ) : (
            <div className="overflow-x-auto mt-1">
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    <th className="text-left pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70">Month</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70">MRR</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70">MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {mrrTrend.slice(-12).reverse().map((row) => {
                    let displayMonth = row.month;
                    try {
                      displayMonth = format(new Date(row.month + "-01"), "MMM yyyy");
                    } catch {
                      displayMonth = row.month;
                    }
                    const isUp = row.momChange >= 0;
                    return (
                      <tr key={row.month} className="border-t border-border group">
                        <td className="py-2.5 font-medium text-muted-foreground group-hover:text-muted-foreground transition-colors">{displayMonth}</td>
                        <td className="py-2.5 text-right num text-muted-foreground font-semibold">
                          {formatCurrency(row.revenue, "INR", true)}
                        </td>
                        <td className="py-2.5 text-right">
                          {row.momChange !== 0 ? (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold num"
                              style={isUp
                                ? { background: "rgba(29,184,132,0.10)", color: "#1db884" }
                                : { background: "rgba(232,58,58,0.10)", color: "#e83a3a" }
                              }
                            >
                              {isUp ? "+" : ""}{row.momChange.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground/70 text-[11px]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
