export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeftRight, TrendingDown, TrendingUp } from "lucide-react";
import { getOrgId, getCashFlowDetails } from "@/lib/data";
import { CashFlowChart } from "@/components/charts/cashflow-chart";
import { CategoryChart } from "@/components/charts/category-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatRunway, runwaySeverity } from "@/lib/utils";
import { format } from "date-fns";

export default async function CashFlowPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const { cashFlowData, monthlyData, forecasts, snapshot, categoryBreakdown } =
    await getCashFlowDetails(orgId);

  const cashBalance = snapshot?.cash_balance ?? 0;
  const burnRate = snapshot?.burn_rate ?? 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Cash Flow</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Monitor inflows, outflows, and your cash position
        </p>
      </div>

      {/* Cash flow chart (90 days) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Cash Flow (90 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {cashFlowData.length > 0 ? (
            <CashFlowChart data={cashFlowData} />
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <ArrowLeftRight className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No transaction data yet</p>
              <Button variant="link" asChild>
                <Link href="/dashboard/connectors">Connect a data source</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forecast cards */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
          Projected Balance
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {forecasts.map(({ days, projectedBalance }) => (
            <MetricCard
              key={days}
              title={`${days}-Day Forecast`}
              value={formatCurrency(projectedBalance, "INR", true)}
              subtitle={`At ₹${formatCurrency(burnRate, "INR", true)}/mo burn`}
              severity={runwaySeverity(projectedBalance / (burnRate / 30 || 1))}
            />
          ))}
        </div>
      </div>

      {/* Inflows vs Outflows table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Monthly Inflows vs Outflows</CardTitle>
        </CardHeader>
        <CardContent>
          {monthlyData.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-center">
              <p className="text-sm text-muted-foreground">No monthly data available</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-muted-foreground font-medium">Month</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">
                      <span className="flex items-center justify-end gap-1">
                        <TrendingUp className="h-3.5 w-3.5 text-green-600" />
                        Inflow
                      </span>
                    </th>
                    <th className="text-right py-2 text-muted-foreground font-medium">
                      <span className="flex items-center justify-end gap-1">
                        <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                        Outflow
                      </span>
                    </th>
                    <th className="text-right py-2 text-muted-foreground font-medium">Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {monthlyData.map((row) => {
                    let displayMonth = row.month;
                    try {
                      displayMonth = format(new Date(row.month + "-01"), "MMM yyyy");
                    } catch {
                      displayMonth = row.month;
                    }
                    return (
                      <tr key={row.month} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 font-medium text-foreground">{displayMonth}</td>
                        <td className="py-2.5 text-right tabular-nums text-green-600 font-medium">
                          {formatCurrency(row.inflow, "INR", true)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-red-500 font-medium">
                          {formatCurrency(row.outflow, "INR", true)}
                        </td>
                        <td className="py-2.5 text-right">
                          <Badge variant={row.net >= 0 ? "success" : "destructive"}>
                            {row.net >= 0 ? "+" : ""}
                            {formatCurrency(row.net, "INR", true)}
                          </Badge>
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

      {/* Category breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Expense Categories</CardTitle>
        </CardHeader>
        <CardContent>
          {categoryBreakdown.length > 0 ? (
            <CategoryChart data={categoryBreakdown} />
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <p className="text-sm text-muted-foreground">No expense data yet</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
