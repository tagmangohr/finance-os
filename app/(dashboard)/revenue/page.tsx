export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import { TrendingUp, ArrowRight, Calendar } from "lucide-react";
import { getOrgId, getRevenueDetails } from "@/lib/data";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatPercent, calcGrowth } from "@/lib/utils";
import { format } from "date-fns";

export default async function RevenuePage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const { revenueByMonth, customers, mrrTrend, currentSnapshot, previousSnapshot } =
    await getRevenueDetails(orgId);

  const mrr = currentSnapshot?.mrr ?? 0;
  const arr = mrr * 12;
  const prevMrr = previousSnapshot?.mrr ?? 0;
  const momGrowth = prevMrr > 0 ? calcGrowth(mrr, prevMrr) : 0;

  // YoY growth: compare current month to same month last year
  const sortedMonths = revenueByMonth.slice().sort((a, b) => a.month.localeCompare(b.month));
  const currentMonthRev = sortedMonths[sortedMonths.length - 1]?.amount ?? 0;
  const yearAgoRev = sortedMonths[sortedMonths.length - 13]?.amount ?? 0;
  const yoyGrowth = yearAgoRev > 0 ? calcGrowth(currentMonthRev, yearAgoRev) : 0;

  // Total revenue for customer % calc
  const totalRevenue = customers.reduce((s, c) => s + c.total_revenue, 0);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Revenue</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Track your revenue performance and growth</p>
      </div>

      {/* Header metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="MRR"
          value={formatCurrency(mrr, "INR", true)}
          subtitle="Monthly Recurring Revenue"
          icon={<TrendingUp className="h-5 w-5" />}
          severity={mrr > 0 ? "good" : "neutral"}
        />
        <MetricCard
          title="ARR"
          value={formatCurrency(arr, "INR", true)}
          subtitle="Annual Run Rate"
          icon={<Calendar className="h-5 w-5" />}
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

      {/* Large revenue chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Revenue (12 months)</CardTitle>
        </CardHeader>
        <CardContent>
          {revenueByMonth.length > 0 ? (
            <RevenueChart data={revenueByMonth} />
          ) : (
            <div className="flex flex-col items-center justify-center h-72 text-center">
              <TrendingUp className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No revenue data yet.</p>
              <Button variant="link" asChild>
                <Link href="/dashboard/connectors">Connect a data source</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Two columns: customers + MRR trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Customer revenue breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Revenue by Customer</CardTitle>
          </CardHeader>
          <CardContent>
            {customers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <p className="text-sm text-muted-foreground">No customer data yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-muted-foreground font-medium">Customer</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Revenue</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">% Share</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Last Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {customers.map((customer) => {
                      const pct = totalRevenue > 0 ? (customer.total_revenue / totalRevenue) * 100 : 0;
                      return (
                        <tr key={customer.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 font-medium text-foreground max-w-[160px] truncate">
                            {customer.name}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">
                            {formatCurrency(customer.total_revenue, "INR", true)}
                          </td>
                          <td className="py-2.5 text-right">
                            <Badge variant={pct > 30 ? "warning" : "secondary"}>
                              {pct.toFixed(1)}%
                            </Badge>
                          </td>
                          <td className="py-2.5 text-right text-muted-foreground">
                            {customer.last_transaction_date
                              ? formatDate(customer.last_transaction_date)
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* MRR trend table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>MRR Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {mrrTrend.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-center">
                <p className="text-sm text-muted-foreground">No MRR history yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 text-muted-foreground font-medium">Month</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">MRR</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">MoM Change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mrrTrend.slice(-12).reverse().map((row) => {
                      let displayMonth = row.month;
                      try {
                        displayMonth = format(new Date(row.month + "-01"), "MMM yyyy");
                      } catch {
                        displayMonth = row.month;
                      }
                      return (
                        <tr key={row.month} className="hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 font-medium text-foreground">{displayMonth}</td>
                          <td className="py-2.5 text-right tabular-nums">
                            {formatCurrency(row.revenue, "INR", true)}
                          </td>
                          <td className="py-2.5 text-right">
                            {row.momChange !== 0 ? (
                              <Badge variant={row.momChange >= 0 ? "success" : "destructive"}>
                                {row.momChange >= 0 ? "+" : ""}
                                {row.momChange.toFixed(1)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
