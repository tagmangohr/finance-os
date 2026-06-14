export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import {
  TrendingUp, Send, Search, Receipt, Zap, Wallet, Gauge, Coins, Flame,
  AlertCircle, AlertTriangle, Info,
} from "lucide-react";

// ─── Small presentational helpers (health signals + unit tiles) ──────
function Signal({ label, tone }: { label: string; tone: "good" | "warn" | "bad" }) {
  const dot = tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}
function Unit({ label, value, color }: { label: string; value?: string; color?: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {value ? (
        <p className="text-[15px] font-semibold" style={color ? { color } : undefined}>{value}</p>
      ) : (
        <span className="inline-block mt-1 text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">add data</span>
      )}
    </div>
  );
}
import { getFinancialSummary, getOrgId } from "@/lib/data";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { CashFlowChart } from "@/components/charts/cashflow-chart";
import { CategoryChart } from "@/components/charts/category-chart";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatRunway } from "@/lib/utils";
import type { IntelligenceAlert } from "@/lib/supabase/types";

// ─── Alert severity styling (token-based) ───────────────────────────
const alertIcons = {
  critical: { Icon: AlertCircle,   dot: "bg-destructive", border: "border-destructive/20", bg: "bg-destructive/[0.06]", color: "text-destructive" },
  warning:  { Icon: AlertTriangle, dot: "bg-warning",     border: "border-warning/20",     bg: "bg-warning/[0.06]",     color: "text-warning" },
  info:     { Icon: Info,          dot: "bg-primary/60",  border: "border-primary/15",     bg: "bg-primary/[0.05]",     color: "text-primary" },
};

function AlertsCard({ alerts }: { alerts: IntelligenceAlert[] }) {
  const top = alerts.slice(0, 4);
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 flex flex-col gap-1 transition-all duration-200 hover:border-border/80 h-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">Active Alerts</span>
        {alerts.length > 0 && (
          <span className="inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-warning/20 text-warning text-[9px] font-bold px-1">
            {alerts.length}
          </span>
        )}
      </div>

      {top.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-4 gap-2">
          <div className="h-7 w-7 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
            <span className="text-success text-xs">✓</span>
          </div>
          <p className="text-[11px] text-muted-foreground">All clear</p>
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
                  <p className="text-[10.5px] text-muted-foreground mt-0.5 line-clamp-1">{alert.message}</p>
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
    <div className={`rounded-xl border border-border bg-card overflow-hidden transition-all duration-200 hover:border-border/80${className ? " " + className : ""}`}>
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

// ─── Page ────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const summary = await getFinancialSummary();
  const {
    alerts, topDebtors, revenueByMonth, cashFlowData, categoryBreakdown,
    mrr, burnRate, cashBalance, runwayDays, mrrGrowth, burnChange, hasData,
  } = summary;

  const mrrSparkline = revenueByMonth.slice(-8).map((r) => r.amount);
  const balanceSparkline = cashFlowData.slice(-12).map((c) => c.balance);
  const totalOutstanding = topDebtors.reduce((s, d) => s + (d.outstanding_amount ?? 0), 0);

  // Financial-health score — only meaningful once there's data (avoid a fake
  // "great score" when everything is ₹0 and runway is artificially infinite).
  const runwayMonths = runwayDays / 30;
  const healthScore = hasData
    ? Math.max(0, Math.min(100, Math.round(
        (Math.min(runwayMonths, 18) / 18) * 60 + (burnRate > 0 ? Math.min(mrr / burnRate, 1) : 1) * 40
      )))
    : null;
  const ringC = 2 * Math.PI * 40;
  const ringDash = healthScore != null ? (healthScore / 100) * ringC : 0;

  return (
    <div className="space-y-3 max-w-[1400px]">

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {!hasData && (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-accent/30 animate-enter">
          <div className="mx-auto h-14 w-14 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
            <Receipt className="h-7 w-7 text-primary" />
          </div>
          <h3 className="font-bold text-foreground text-base mb-2">Connect your data</h3>
          <p className="text-[13px] text-muted-foreground mb-5 max-w-sm mx-auto leading-relaxed">
            Link a payment gateway or accounting tool to unlock your financial intelligence dashboard.
          </p>
          <Button asChild className="gap-2">
            <Link href="/dashboard/connectors">
              <Zap className="h-4 w-4" />
              Connect a data source
            </Link>
          </Button>
        </div>
      )}

      {/* ── KPI strip ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 animate-enter">
        <MetricCard
          title="Cash Balance" value={formatCurrency(cashBalance, "INR", true)}
          icon={<Wallet className="w-4 h-4" />} accentColor="hsl(var(--metric-cash))"
          sparklineData={balanceSparkline.length >= 2 ? balanceSparkline : undefined}
        />
        <MetricCard
          title="Runway" value={formatRunway(runwayDays)}
          subtitle={`${formatCurrency(burnRate, "INR", true)}/mo burn`}
          icon={<Gauge className="w-4 h-4" />} accentColor="hsl(var(--metric-runway))"
        />
        <MetricCard
          title="MRR" value={formatCurrency(mrr, "INR", true)}
          trend={mrrGrowth !== 0 ? mrrGrowth : undefined} trendLabel="MoM"
          icon={<TrendingUp className="w-4 h-4" />} accentColor="hsl(var(--metric-revenue))"
          sparklineData={mrrSparkline.length >= 2 ? mrrSparkline : undefined}
        />
        <MetricCard
          title="ARR" value={formatCurrency(mrr * 12, "INR", true)}
          subtitle="Annual run rate"
          icon={<Coins className="w-4 h-4" />} accentColor="hsl(var(--metric-profit))"
        />
        <MetricCard
          title="Burn Rate" value={`${formatCurrency(burnRate, "INR", true)}/mo`}
          subtitle={burnChange !== 0 ? `${burnChange > 0 ? "+" : ""}${burnChange.toFixed(0)}% MoM` : "Operating burn"}
          icon={<Flame className="w-4 h-4" />} accentColor="hsl(var(--metric-opex))"
        />
        <MetricCard
          title="Receivables" value={formatCurrency(totalOutstanding, "INR", true)}
          subtitle="Top accounts"
          icon={<Receipt className="w-4 h-4" />} accentColor="hsl(var(--metric-margin))"
        />
      </div>

      {/* ── Revenue (2/3) + Top debtors (1/3) ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-1">
        <SectionCard title="Revenue" subtitle="last 12 months" className="lg:col-span-2">
          {revenueByMonth.length > 0 ? (
            <RevenueChart data={revenueByMonth} />
          ) : (
            <div className="flex flex-col items-center justify-center h-52 text-center gap-3">
              <TrendingUp className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-[13px] text-muted-foreground">No revenue data yet</p>
              <Link href="/dashboard/connectors" className="text-[12px] text-primary hover:underline">Connect a source →</Link>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Top Debtors"
          action={topDebtors.length > 0 ? (
            <Link href="/dashboard/collections" className="text-[10.5px] text-muted-foreground hover:text-primary transition-colors">View all →</Link>
          ) : undefined}
        >
          {topDebtors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[220px] gap-2">
              <div className="h-9 w-9 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
                <span className="text-success">✓</span>
              </div>
              <p className="text-[12px] text-muted-foreground">No outstanding receivables</p>
            </div>
          ) : (
            <div className="space-y-2 mt-1">
              {topDebtors.slice(0, 5).map((debtor, idx) => (
                <div key={debtor.id} className="flex items-center gap-2.5 group">
                  <div className="h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-primary/10 text-primary border border-primary/15">
                    {idx + 1}
                  </div>
                  <p className="text-[12px] text-muted-foreground truncate flex-1 group-hover:text-foreground transition-colors">{debtor.name}</p>
                  <p className="num text-[12px] font-semibold text-foreground/80 flex-shrink-0">
                    {formatCurrency(debtor.outstanding_amount, "INR", true)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Cash flow + Expense breakdown ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 animate-enter-2">
        <SectionCard title="Cash Flow" subtitle="last 30 days">
          {cashFlowData.length > 0 ? (
            <CashFlowChart data={cashFlowData} />
          ) : (
            <div className="flex flex-col items-center justify-center h-52 text-center gap-2">
              <p className="text-[13px] text-muted-foreground">No transaction data yet</p>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Expense Breakdown">
          {categoryBreakdown.length > 0 ? (
            <CategoryChart data={categoryBreakdown} />
          ) : (
            <div className="flex flex-col items-center justify-center h-52 text-center gap-2">
              <Receipt className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-[13px] text-muted-foreground">No expense data yet</p>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Financial health + unit economics ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-3">
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
          <svg viewBox="0 0 96 96" width="90" height="90" className="flex-shrink-0" role="img" aria-label={`Financial health score ${healthScore ?? "not available"}`}>
            <circle cx="48" cy="48" r="40" fill="none" stroke="hsl(var(--accent))" strokeWidth="9" />
            <circle cx="48" cy="48" r="40" fill="none" stroke="hsl(var(--metric-profit))" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${ringDash} ${ringC}`} transform="rotate(-90 48 48)" />
            <text x="48" y="46" textAnchor="middle" className="fill-foreground" style={{ fontSize: 22, fontWeight: 700 }}>
              {healthScore != null ? healthScore : "—"}
            </text>
            <text x="48" y="62" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>health</text>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground mb-2">Financial health</p>
            <div className="space-y-1.5 text-[11.5px]">
              <Signal label={`Runway ${formatRunway(runwayDays)}`} tone={!hasData ? "warn" : runwayMonths >= 12 ? "good" : runwayMonths >= 6 ? "warn" : "bad"} />
              <Signal label={`Burn ${formatCurrency(burnRate, "INR", true)}/mo`} tone={burnRate === 0 || mrr >= burnRate ? "good" : "warn"} />
              <Signal label={`MRR ${formatCurrency(mrr, "INR", true)}`} tone={mrr > 0 ? "good" : "bad"} />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
          <p className="text-[13px] font-semibold text-foreground mb-3">Unit economics</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <Unit label="MRR" value={formatCurrency(mrr, "INR", true)} color="hsl(var(--metric-revenue))" />
            <Unit label="ARR" value={formatCurrency(mrr * 12, "INR", true)} color="hsl(var(--metric-profit))" />
            <Unit label="Customers" />
            <Unit label="ARPU" />
            <Unit label="CAC" />
            <Unit label="LTV / CAC" />
          </div>
        </div>
      </div>

      {/* ── Alerts + quick actions ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-3">
        <AlertsCard alerts={alerts} />
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-3.5">
          <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-2.5">Quick Actions</p>
          <div className="flex flex-wrap gap-2">
            {topDebtors.length > 0 && (
              <Link href="/dashboard/collections" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[11.5px] font-medium border border-border bg-accent/40 text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-150">
                <Send className="h-3 w-3" />
                Collect from {topDebtors[0].name}
              </Link>
            )}
            <Link href="/dashboard/intelligence" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[11.5px] font-medium border border-primary/20 bg-primary/[0.06] text-primary hover:bg-primary/[0.12] hover:border-primary/30 transition-all duration-150">
              <Search className="h-3 w-3" />
              Ask AI anything
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
