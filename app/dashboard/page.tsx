export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import {
  TrendingUp,
  Flame,
  Wallet,
  Send,
  Search,
  Receipt,
  ArrowRight,
  Zap,
  AlertCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { getFinancialSummary, getOrgId } from "@/lib/data";
import { RunwayCard } from "@/components/dashboard/runway-card";
import { MetricCard } from "@/components/dashboard/metric-card";
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
import type { IntelligenceAlert } from "@/lib/supabase/types";

// ─── Alert severity icon map ────────────────────────────────────────
const alertIcons = {
  critical: { Icon: AlertCircle, color: "text-red-400", bg: "bg-red-400/10 border-red-400/20", dot: "bg-red-400" },
  warning: { Icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20", dot: "bg-amber-400" },
  info: { Icon: Info, color: "text-primary/70", bg: "bg-primary/10 border-primary/20", dot: "bg-primary/60" },
};

function AlertsCard({ alerts }: { alerts: IntelligenceAlert[] }) {
  const top = alerts.slice(0, 4);
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-5 flex flex-col h-full transition-all duration-300 hover:border-border hover:-translate-y-0.5">
      <p className="text-[10px] font-semibold text-white/35 uppercase tracking-[0.12em] mb-3">
        Active Alerts
        {top.length > 0 && (
          <span className="ml-2 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-400/20 text-amber-400 text-[9px] font-bold">
            {alerts.length}
          </span>
        )}
      </p>
      {top.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
          <div className="h-8 w-8 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mb-2">
            <span className="text-emerald-400 text-sm">✓</span>
          </div>
          <p className="text-xs text-white/25">All clear</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 flex-1">
          {top.map((alert) => {
            const cfg = alertIcons[alert.severity];
            const { Icon } = cfg;
            return (
              <div key={alert.id} className={`flex items-start gap-2.5 rounded-xl border p-2.5 ${cfg.bg}`}>
                <span className={`h-1.5 w-1.5 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
                <div className="min-w-0">
                  <p className={`text-xs font-semibold truncate ${cfg.color}`}>{alert.title}</p>
                  <p className="text-[11px] text-white/30 mt-0.5 line-clamp-1">{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const summary = await getFinancialSummary();
  const { snapshot, previousSnapshot, alerts, topDebtors, revenueByMonth, cashFlowData, categoryBreakdown } = summary;

  const runwayDays = snapshot?.runway_days ?? 0;
  const mrr = snapshot?.mrr ?? 0;
  const burnRate = snapshot?.burn_rate ?? 0;
  const cashBalance = snapshot?.cash_balance ?? 0;

  const prevMrr = previousSnapshot?.mrr ?? 0;
  const prevBurn = previousSnapshot?.burn_rate ?? 0;
  const mrrGrowth = prevMrr > 0 ? calcGrowth(mrr, prevMrr) : 0;
  const burnChange = prevBurn > 0 ? calcGrowth(burnRate, prevBurn) : 0;

  const hasConnectors = snapshot !== null;

  // Sparkline data
  const mrrSparkline = revenueByMonth.slice(-8).map((r) => r.amount);
  const balanceSparkline = cashFlowData.slice(-12).map((c) => c.balance);

  return (
    <div className="space-y-3 max-w-[1400px]">

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!hasConnectors && (
        <div className="rounded-2xl border border-dashed border-white/[0.07] p-12 text-center bg-white/[0.015] animate-fade-in">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5 shadow-[0_0_30px_hsl(258_88%_66%/0.15)]">
            <Receipt className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-bold text-white/75 text-lg mb-2">Connect your data</h3>
          <p className="text-sm text-white/30 mb-6 max-w-sm mx-auto leading-relaxed">
            Link a payment gateway or accounting tool to unlock your financial intelligence dashboard.
          </p>
          <Button asChild className="gap-2 shadow-[0_0_20px_hsl(258_88%_66%/0.3)]">
            <Link href="/dashboard/connectors">
              <Zap className="h-4 w-4" />
              Connect a data source
            </Link>
          </Button>
        </div>
      )}

      {/* ── Row 1: Runway hero (2/3) + Cash Balance (1/3) ───────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter">
        <RunwayCard
          days={runwayDays}
          formattedValue={formatRunway(runwayDays)}
          burnRate={burnRate}
          formattedBurn={formatCurrency(burnRate, "INR", true)}
          severity={runwaySeverity(runwayDays)}
          className="lg:col-span-2"
        />
        <MetricCard
          title="Cash Balance"
          value={formatCurrency(cashBalance, "INR", true)}
          subtitle={snapshot ? `Updated ${formatDate(snapshot.snapshot_date)}` : "No data"}
          icon={<Wallet className="h-4 w-4" />}
          severity={
            cashBalance < burnRate * 3 ? "critical"
            : cashBalance < burnRate * 6 ? "warning"
            : "good"
          }
          sparklineData={balanceSparkline.length >= 2 ? balanceSparkline : undefined}
          sparklineColor="hsl(158, 64%, 48%)"
        />
      </div>

      {/* ── Row 2: MRR + Burn Rate + Alerts ──────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-enter-delay-1">
        <MetricCard
          title="MRR"
          value={formatCurrency(mrr, "INR", true)}
          trend={mrrGrowth !== 0 ? mrrGrowth : undefined}
          trendLabel="MoM"
          subtitle={prevMrr === 0 ? "No prior period" : undefined}
          icon={<TrendingUp className="h-4 w-4" />}
          severity={mrr > 0 ? "good" : "neutral"}
          sparklineData={mrrSparkline.length >= 2 ? mrrSparkline : undefined}
          sparklineColor="hsl(158, 64%, 48%)"
        />
        <MetricCard
          title="Burn Rate"
          value={formatCurrency(burnRate, "INR", true) + "/mo"}
          trend={burnChange !== 0 ? burnChange : undefined}
          trendLabel="MoM"
          subtitle={prevBurn === 0 ? "No prior period" : undefined}
          icon={<Flame className="h-4 w-4" />}
          severity={burnChange > 40 ? "critical" : burnChange > 20 ? "warning" : "neutral"}
        />
        <AlertsCard alerts={alerts} />
      </div>

      {/* ── Row 3: Revenue chart (2/3) + Top Debtors (1/3) ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-delay-2">
        <Card className="lg:col-span-2 hover:border-border transition-all duration-300 hover:-translate-y-0.5">
          <CardHeader>
            <CardTitle>Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueByMonth.length > 0 ? (
              <RevenueChart data={revenueByMonth} />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <TrendingUp className="h-8 w-8 text-white/10 mb-3" />
                <p className="text-sm text-white/25">No revenue data yet</p>
                <Button variant="link" size="sm" asChild className="mt-1 text-primary/60 hover:text-primary">
                  <Link href="/dashboard/connectors">Connect a source →</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="hover:border-border transition-all duration-300 hover:-translate-y-0.5">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Top Debtors</CardTitle>
              {topDebtors.length > 0 && (
                <Link
                  href="/dashboard/collections"
                  className="text-[11px] text-white/30 hover:text-primary transition-colors"
                >
                  View all →
                </Link>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {topDebtors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center">
                <div className="h-10 w-10 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center mb-3">
                  <span className="text-emerald-400 text-lg">✓</span>
                </div>
                <p className="text-sm text-white/25">No outstanding receivables</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {topDebtors.slice(0, 5).map((debtor, idx) => (
                  <div key={debtor.id} className="group flex items-center gap-3">
                    <div
                      className="h-7 w-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{
                        background: `hsl(258 88% 66% / ${0.06 + idx * 0.02})`,
                        color: `hsl(258 88% 66% / ${0.4 + idx * 0.05})`,
                        border: `1px solid hsl(258 88% 66% / 0.12)`,
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white/70 truncate group-hover:text-white/90 transition-colors">
                        {debtor.name}
                      </p>
                      <p className="text-[11px] text-white/25">
                        {debtor.last_transaction_date
                          ? `Last: ${formatDate(debtor.last_transaction_date)}`
                          : "No transactions"}
                      </p>
                    </div>
                    <div
                      className="text-sm font-bold flex-shrink-0"
                      style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.65)" }}
                    >
                      {formatCurrency(debtor.outstanding_amount, "INR", true)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 4: Cash Flow + Expense ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 animate-enter-delay-3">
        <Card className="hover:border-border transition-all duration-300 hover:-translate-y-0.5">
          <CardHeader>
            <CardTitle>
              Cash Flow
              <span className="ml-2 text-white/20 font-normal text-xs">last 30 days</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cashFlowData.length > 0 ? (
              <CashFlowChart data={cashFlowData} />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <ArrowRight className="h-8 w-8 text-white/10 mb-3" />
                <p className="text-sm text-white/25">No transaction data yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="hover:border-border transition-all duration-300 hover:-translate-y-0.5">
          <CardHeader>
            <CardTitle>Expense Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryBreakdown.length > 0 ? (
              <CategoryChart data={categoryBreakdown} />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <Receipt className="h-8 w-8 text-white/10 mb-3" />
                <p className="text-sm text-white/25">No expense data yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 5: Quick actions ──────────────────────────────────────── */}
      <div className="rounded-2xl bg-card border border-border/60 p-5 animate-enter-delay-4 hover:border-border transition-all duration-300">
        <p className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.12em] mb-3">Quick Actions</p>
        <div className="flex flex-wrap gap-2">
          {topDebtors.length > 0 && (
            <Link
              href="/dashboard/collections"
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium border border-white/[0.07] bg-white/[0.02] text-white/40 hover:text-white/70 hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-150"
            >
              <Send className="h-3 w-3" />
              Collect from {topDebtors[0].name}
            </Link>
          )}
          {alerts.some((a) => a.type === "anomaly") && (
            <Link
              href="/dashboard/intelligence"
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/[0.1] hover:border-amber-500/30 transition-all duration-150"
            >
              <Search className="h-3 w-3" />
              Review anomaly
            </Link>
          )}
          {alerts.some((a) => a.type === "tax_due") && (
            <Link
              href="/dashboard/intelligence"
              className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium border border-white/[0.07] bg-white/[0.02] text-white/40 hover:text-white/70 hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-150"
            >
              <Receipt className="h-3 w-3" />
              Check tax position
            </Link>
          )}
          <Link
            href="/dashboard/intelligence"
            className="flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-medium border border-primary/20 bg-primary/[0.06] text-primary/60 hover:text-primary hover:bg-primary/[0.1] hover:border-primary/30 transition-all duration-150"
          >
            <Search className="h-3 w-3" />
            Ask AI anything
          </Link>
        </div>
      </div>
    </div>
  );
}
