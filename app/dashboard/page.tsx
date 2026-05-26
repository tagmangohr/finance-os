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
  critical: { Icon: AlertCircle,  dot: "bg-red-400",   border: "border-red-400/20",   bg: "bg-red-400/[0.06]",   color: "text-red-400" },
  warning:  { Icon: AlertTriangle, dot: "bg-amber-400", border: "border-amber-400/20", bg: "bg-amber-400/[0.06]", color: "text-amber-400" },
  info:     { Icon: Info,          dot: "bg-primary/60", border: "border-primary/15",  bg: "bg-primary/[0.05]",   color: "text-primary/70" },
};

function AlertsCard({ alerts }: { alerts: IntelligenceAlert[] }) {
  const top = alerts.slice(0, 4);
  return (
    <div
      className="rounded-xl border border-white/[0.06] p-3.5 flex flex-col gap-1 transition-all duration-200 hover:border-white/[0.10] hover:-translate-y-px h-full"
      style={{ background: "hsl(220 40% 7%)" }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/40">Active Alerts</span>
        {alerts.length > 0 && (
          <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-amber-400/20 text-amber-400 text-[9px] font-bold px-1">
            {alerts.length}
          </span>
        )}
      </div>

      {top.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-4 gap-2">
          <div className="h-7 w-7 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
            <span className="text-emerald-400 text-xs">✓</span>
          </div>
          <p className="text-[11px] text-white/25">All clear</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 mt-1">
          {top.map((alert) => {
            const cfg = alertIcons[alert.severity];
            return (
              <div key={alert.id} className={`flex items-start gap-2 rounded-lg border p-2 ${cfg.bg} ${cfg.border}`}>
                <span className={`h-1.5 w-1.5 rounded-full mt-1.5 flex-shrink-0 ${cfg.dot}`} />
                <div className="min-w-0">
                  <p className={`text-[11px] font-semibold truncate ${cfg.color}`}>{alert.title}</p>
                  <p className="text-[10.5px] text-white/30 mt-0.5 line-clamp-1">{alert.message}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────
function SectionCard({ title, subtitle, action, children, className }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-white/[0.06] overflow-hidden transition-all duration-200 hover:border-white/[0.09]${className ? " " + className : ""}`}
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
        <div className="rounded-xl border border-dashed border-white/[0.07] p-12 text-center bg-white/[0.015] animate-enter">
          <div className="mx-auto h-14 w-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4"
            style={{ boxShadow: "0 0 24px rgba(124,82,240,0.2)" }}>
            <Receipt className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-bold text-white/75 text-base mb-2">Connect your data</h3>
          <p className="text-[13px] text-white/30 mb-5 max-w-sm mx-auto leading-relaxed">
            Link a payment gateway or accounting tool to unlock your financial intelligence dashboard.
          </p>
          <Button asChild className="gap-2" style={{ boxShadow: "0 0 20px rgba(124,82,240,0.3)" }}>
            <Link href="/dashboard/connectors">
              <Zap className="h-4 w-4" />
              Connect a data source
            </Link>
          </Button>
        </div>
      )}

      {/* ── Row 1: Runway hero (1.6fr) + metric cards (1fr) ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-3 animate-enter">
        <RunwayCard
          days={runwayDays}
          formattedValue={formatRunway(runwayDays)}
          burnRate={burnRate}
          formattedBurn={formatCurrency(burnRate, "INR", true)}
          cashBalance={cashBalance}
          formattedCash={formatCurrency(cashBalance, "INR", true)}
          severity={runwaySeverity(runwayDays)}
        />
        <div className="flex flex-col gap-3">
          <MetricCard
            title="Cash Balance"
            value={formatCurrency(cashBalance, "INR", true)}
            subtitle={snapshot ? `Updated ${formatDate(snapshot.snapshot_date)}` : "No data"}
            severity={
              cashBalance < burnRate * 3 ? "critical"
              : cashBalance < burnRate * 6 ? "warning"
              : "good"
            }
            sparklineData={balanceSparkline.length >= 2 ? balanceSparkline : undefined}
            sparklineColor="#1db884"
          />
          <AlertsCard alerts={alerts} />
        </div>
      </div>

      {/* ── Row 2: MRR + Burn Rate + (2 more slots) ─────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-enter-delay-1">
        <MetricCard
          title="MRR"
          value={formatCurrency(mrr, "INR", true)}
          trend={mrrGrowth !== 0 ? mrrGrowth : undefined}
          trendLabel="MoM"
          subtitle={prevMrr === 0 ? "No prior period" : undefined}
          severity={mrr > 0 ? "good" : "neutral"}
          sparklineData={mrrSparkline.length >= 2 ? mrrSparkline : undefined}
          sparklineColor="#1db884"
        />
        <MetricCard
          title="Burn Rate"
          value={formatCurrency(burnRate, "INR", true) + "/mo"}
          trend={burnChange !== 0 ? burnChange : undefined}
          trendLabel="MoM"
          subtitle={prevBurn === 0 ? "No prior period" : undefined}
          severity={burnChange > 40 ? "critical" : burnChange > 20 ? "warning" : "neutral"}
        />
        <MetricCard
          title="ARR"
          value={formatCurrency(mrr * 12, "INR", true)}
          subtitle="Annual run rate"
          severity={mrr > 0 ? "good" : "neutral"}
        />
        <MetricCard
          title="Net Burn"
          value={formatCurrency(burnRate, "INR", true) + "/mo"}
          subtitle="Operating burn"
          severity={burnRate > mrr * 1.5 ? "critical" : burnRate > mrr ? "warning" : "good"}
        />
      </div>

      {/* ── Row 3: Revenue chart (2/3) + Top Debtors (1/3) ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-delay-2">
        <SectionCard title="Revenue" subtitle="last 12 months" className="lg:col-span-2">
          {revenueByMonth.length > 0 ? (
            <RevenueChart data={revenueByMonth} />
          ) : (
            <div className="flex flex-col items-center justify-center h-52 text-center gap-3">
              <TrendingUp className="h-7 w-7 text-white/10" />
              <p className="text-[13px] text-white/25">No revenue data yet</p>
              <Link href="/dashboard/connectors" className="text-[12px] text-primary/60 hover:text-primary transition-colors">
                Connect a source →
              </Link>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Top Debtors"
          action={topDebtors.length > 0 ? (
            <Link href="/dashboard/collections" className="text-[10.5px] text-white/25 hover:text-primary transition-colors">
              View all →
            </Link>
          ) : undefined}
        >
          {topDebtors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[220px] gap-2">
              <div className="h-9 w-9 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                <span className="text-emerald-400">✓</span>
              </div>
              <p className="text-[12px] text-white/25">No outstanding receivables</p>
            </div>
          ) : (
            <div className="space-y-2 mt-1">
              {topDebtors.slice(0, 5).map((debtor, idx) => (
                <div key={debtor.id} className="flex items-center gap-2.5 group">
                  <div
                    className="h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{
                      background: `rgba(124,82,240,${0.06 + idx * 0.02})`,
                      color: `rgba(124,82,240,${0.5 + idx * 0.05})`,
                      border: "1px solid rgba(124,82,240,0.12)",
                    }}
                  >
                    {idx + 1}
                  </div>
                  <p className="text-[12px] text-white/55 truncate flex-1 group-hover:text-white/80 transition-colors">{debtor.name}</p>
                  <p className="num text-[12px] font-semibold text-white/60 flex-shrink-0">
                    {formatCurrency(debtor.outstanding_amount, "INR", true)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Row 4: Cash Flow + Expense ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 animate-enter-delay-3">
        <SectionCard title="Cash Flow" subtitle="last 30 days">
          {cashFlowData.length > 0 ? (
            <CashFlowChart data={cashFlowData} />
          ) : (
            <div className="flex flex-col items-center justify-center h-52 text-center gap-2">
              <p className="text-[13px] text-white/25">No transaction data yet</p>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Expense Breakdown">
          {categoryBreakdown.length > 0 ? (
            <CategoryChart data={categoryBreakdown} />
          ) : (
            <div className="flex flex-col items-center justify-center h-52 text-center gap-2">
              <Receipt className="h-7 w-7 text-white/10" />
              <p className="text-[13px] text-white/25">No expense data yet</p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Row 5: Quick actions ──────────────────────────────────────── */}
      <div
        className="rounded-xl border border-white/[0.06] p-3.5 animate-enter-delay-4"
        style={{ background: "hsl(220 40% 7%)" }}
      >
        <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/25 mb-2.5">Quick Actions</p>
        <div className="flex flex-wrap gap-2">
          {topDebtors.length > 0 && (
            <Link
              href="/dashboard/collections"
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[11.5px] font-medium border border-white/[0.07] bg-white/[0.02] text-white/40 hover:text-white/70 hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-150"
            >
              <Send className="h-3 w-3" />
              Collect from {topDebtors[0].name}
            </Link>
          )}
          {alerts.some((a) => a.type === "anomaly") && (
            <Link
              href="/dashboard/intelligence"
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[11.5px] font-medium border border-amber-500/20 bg-amber-500/[0.05] text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/[0.1] hover:border-amber-500/30 transition-all duration-150"
            >
              <Search className="h-3 w-3" />
              Review anomaly
            </Link>
          )}
          {alerts.some((a) => a.type === "tax_due") && (
            <Link
              href="/dashboard/intelligence"
              className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[11.5px] font-medium border border-white/[0.07] bg-white/[0.02] text-white/40 hover:text-white/70 hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-150"
            >
              <Receipt className="h-3 w-3" />
              Check tax position
            </Link>
          )}
          <Link
            href="/dashboard/intelligence"
            className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[11.5px] font-medium border border-primary/20 bg-primary/[0.06] text-primary/60 hover:text-primary hover:bg-primary/[0.10] hover:border-primary/30 transition-all duration-150"
          >
            <Search className="h-3 w-3" />
            Ask AI anything
          </Link>
        </div>
      </div>
    </div>
  );
}
