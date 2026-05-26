export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { getOrgId, getRevenueDetails } from "@/lib/data";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatPercent, calcGrowth } from "@/lib/utils";
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
      className="rounded-xl border border-white/[0.06] overflow-hidden transition-all duration-200 hover:border-white/[0.09]"
      style={{ background: "hsl(220 40% 7%)" }}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-0">
        <div>
          <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/40">{title}</p>
          {subtitle && <p className="text-[10.5px] text-white/20 mt-0.5">{subtitle}</p>}
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

  const { revenueByMonth, customers, mrrTrend, currentSnapshot, previousSnapshot } =
    await getRevenueDetails(orgId);

  const mrr = currentSnapshot?.mrr ?? 0;
  const arr = mrr * 12;
  const prevMrr = previousSnapshot?.mrr ?? 0;
  const momGrowth = prevMrr > 0 ? calcGrowth(mrr, prevMrr) : 0;

  // YoY growth
  const sortedMonths = revenueByMonth.slice().sort((a, b) => a.month.localeCompare(b.month));
  const currentMonthRev = sortedMonths[sortedMonths.length - 1]?.amount ?? 0;
  const yearAgoRev = sortedMonths[sortedMonths.length - 13]?.amount ?? 0;
  const yoyGrowth = yearAgoRev > 0 ? calcGrowth(currentMonthRev, yearAgoRev) : 0;

  const totalRevenue = customers.reduce((s, c) => s + c.total_revenue, 0);

  return (
    <div className="space-y-3 max-w-[1400px]">

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="animate-enter">
        <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-white/25 mb-0.5">Finance OS</p>
        <h1 className="text-[22px] font-bold tracking-tight text-white/90 leading-none">Revenue</h1>
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
            <TrendingUp className="h-7 w-7 text-white/10" />
            <p className="text-[13px] text-white/25">No revenue data yet.</p>
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
            <div className="flex items-center justify-center h-32 text-[13px] text-white/25">
              No customer data yet
            </div>
          ) : (
            <div className="overflow-x-auto mt-1">
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    <th className="text-left pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Customer</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Revenue</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25 hidden sm:table-cell">Share</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25 hidden md:table-cell">Last Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const pct = totalRevenue > 0 ? (customer.total_revenue / totalRevenue) * 100 : 0;
                    const isHighConc = pct > 30;
                    return (
                      <tr key={customer.id} className="border-t border-white/[0.04] group">
                        <td className="py-2.5 font-medium text-white/60 max-w-[140px] truncate group-hover:text-white/80 transition-colors">
                          {customer.name}
                        </td>
                        <td className="py-2.5 text-right num text-white/70 font-semibold">
                          {formatCurrency(customer.total_revenue, "INR", true)}
                        </td>
                        <td className="py-2.5 text-right hidden sm:table-cell">
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold"
                            style={isHighConc
                              ? { background: "rgba(245,145,22,0.12)", color: "#f59116" }
                              : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }
                            }
                          >
                            {pct.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2.5 text-right text-white/30 hidden md:table-cell">
                          {customer.last_transaction_date ? formatDate(customer.last_transaction_date) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Concentration bars */}
              <div className="mt-3 pt-3 border-t border-white/[0.05] space-y-1.5">
                {customers.slice(0, 5).map((customer) => {
                  const pct = totalRevenue > 0 ? (customer.total_revenue / totalRevenue) * 100 : 0;
                  return (
                    <div key={customer.id} className="flex items-center gap-2.5">
                      <span className="text-[10.5px] text-white/35 w-28 truncate flex-shrink-0">{customer.name}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            background: pct > 30 ? "#f59116" : "#7c52f0",
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <span className="num text-[10.5px] text-white/40 w-9 text-right flex-shrink-0">{pct.toFixed(1)}%</span>
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
            <div className="flex items-center justify-center h-32 text-[13px] text-white/25">
              No MRR history yet
            </div>
          ) : (
            <div className="overflow-x-auto mt-1">
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    <th className="text-left pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Month</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">MRR</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">MoM</th>
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
                      <tr key={row.month} className="border-t border-white/[0.04] group">
                        <td className="py-2.5 font-medium text-white/55 group-hover:text-white/75 transition-colors">{displayMonth}</td>
                        <td className="py-2.5 text-right num text-white/70 font-semibold">
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
                            <span className="text-white/20 text-[11px]">—</span>
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
