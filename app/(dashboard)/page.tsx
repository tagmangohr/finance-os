export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Timer,
  TrendingUp,
  Flame,
  Wallet,
  Send,
  Search,
  Receipt,
  ArrowRight,
} from "lucide-react";
import { getFinancialSummary, getOrgId } from "@/lib/data";
import { MetricCard } from "@/components/dashboard/metric-card";
import { AlertBanner } from "@/components/dashboard/alert-banner";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { CashFlowChart } from "@/components/charts/cashflow-chart";
import { CategoryChart } from "@/components/charts/category-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  formatCurrency,
  formatDate,
  formatRunway,
  runwaySeverity,
  calcGrowth,
} from "@/lib/utils";

export default async function DashboardPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const summary = await getFinancialSummary();
  const { snapshot, previousSnapshot, alerts, topDebtors, revenueByMonth, cashFlowData, categoryBreakdown } = summary;

  // Metric values
  const runwayDays = snapshot?.runway_days ?? 0;
  const mrr = snapshot?.mrr ?? 0;
  const burnRate = snapshot?.burn_rate ?? 0;
  const cashBalance = snapshot?.cash_balance ?? 0;

  const prevMrr = previousSnapshot?.mrr ?? 0;
  const prevBurn = previousSnapshot?.burn_rate ?? 0;
  const mrrGrowth = prevMrr > 0 ? calcGrowth(mrr, prevMrr) : 0;
  const burnChange = prevBurn > 0 ? calcGrowth(burnRate, prevBurn) : 0;

  const hasConnectors = snapshot !== null;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-xl font-semibold text-foreground">War Room</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {/* Empty state */}
      {!hasConnectors && (
        <div className="rounded-xl border-2 border-dashed border-border p-10 text-center bg-card">
          <div className="mx-auto h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
            <Receipt className="h-6 w-6 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground text-base mb-1">No data yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">
            Connect your payment gateway or accounting software to start seeing your financial dashboard.
          </p>
          <Button asChild>
            <Link href="/dashboard/connectors">
              Connect a data source
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Runway"
          value={formatRunway(runwayDays)}
          subtitle={`At ₹${formatCurrency(burnRate, "INR", true)}/mo burn`}
          severity={runwaySeverity(runwayDays)}
          icon={<Timer className="h-5 w-5" />}
        />
        <MetricCard
          title="MRR"
          value={formatCurrency(mrr, "INR", true)}
          trend={mrrGrowth !== 0 ? mrrGrowth : undefined}
          trendLabel="MoM"
          subtitle={prevMrr === 0 ? "No previous data" : undefined}
          icon={<TrendingUp className="h-5 w-5" />}
          severity={mrr > 0 ? "good" : "neutral"}
        />
        <MetricCard
          title="Burn Rate"
          value={formatCurrency(burnRate, "INR", true) + "/mo"}
          trend={burnChange !== 0 ? burnChange : undefined}
          trendLabel="MoM"
          subtitle={prevBurn === 0 ? "No previous data" : undefined}
          icon={<Flame className="h-5 w-5" />}
          severity={burnChange > 20 ? "warning" : burnChange > 40 ? "critical" : "neutral"}
        />
        <MetricCard
          title="Cash Balance"
          value={formatCurrency(cashBalance, "INR", true)}
          subtitle={snapshot ? `Updated ${formatDate(snapshot.snapshot_date)}` : "No data"}
          icon={<Wallet className="h-5 w-5" />}
          severity={cashBalance < burnRate * 3 ? "critical" : cashBalance < burnRate * 6 ? "warning" : "good"}
        />
      </div>

      {/* Alert banner */}
      {alerts.length > 0 && <AlertBanner alerts={alerts} />}

      {/* Middle row: Revenue chart + Top debtors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle>Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueByMonth.length > 0 ? (
              <RevenueChart data={revenueByMonth} />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <TrendingUp className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No revenue data yet</p>
                <Button variant="link" size="sm" asChild className="mt-1">
                  <Link href="/dashboard/connectors">Connect a source</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Top Debtors</CardTitle>
          </CardHeader>
          <CardContent>
            {topDebtors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <p className="text-sm text-muted-foreground">No outstanding receivables</p>
              </div>
            ) : (
              <div className="space-y-3">
                {topDebtors.slice(0, 5).map((debtor, idx) => (
                  <div key={debtor.id} className="flex items-center gap-3">
                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground flex-shrink-0">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{debtor.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {debtor.last_transaction_date
                          ? `Last: ${formatDate(debtor.last_transaction_date)}`
                          : "No transactions"}
                      </p>
                    </div>
                    <div className="text-sm font-semibold text-foreground flex-shrink-0">
                      {formatCurrency(debtor.outstanding_amount, "INR", true)}
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                  <Link href="/dashboard/collections">View all</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Cash flow + Category */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Cash Flow (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {cashFlowData.length > 0 ? (
              <CashFlowChart data={cashFlowData} />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <ArrowRight className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No transaction data yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryBreakdown.length > 0 ? (
              <CategoryChart data={categoryBreakdown} />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <Receipt className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No expense data yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {topDebtors.length > 0 && (
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <Link href="/dashboard/collections">
                  <Send className="h-3.5 w-3.5" />
                  Collect from {topDebtors[0].name}
                </Link>
              </Button>
            )}
            {alerts.some((a) => a.type === "anomaly") && (
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <Link href="/dashboard/intelligence">
                  <Search className="h-3.5 w-3.5" />
                  Review anomaly
                </Link>
              </Button>
            )}
            {alerts.some((a) => a.type === "tax_due") && (
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <Link href="/dashboard/intelligence">
                  <Receipt className="h-3.5 w-3.5" />
                  Check tax position
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-1.5" asChild>
              <Link href="/dashboard/intelligence">
                <Search className="h-3.5 w-3.5" />
                Ask AI anything
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
