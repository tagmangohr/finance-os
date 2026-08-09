export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { Wallet, Flame, ArrowLeftRight, TrendingUp } from "lucide-react";
import { getOrgId, getCashFlowDetails, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { PreviewBanner } from "@/components/dashboard/preview-banner";
import { RangeFilterBar } from "@/components/dashboard/range-filter-bar";
import { InflowOutflowChart } from "@/components/charts/inflow-outflow-chart";
import { CategoryChart } from "@/components/charts/category-chart";
import { formatCurrency } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SAMPLE = {
  burnRate: 920000, cashBalance: 14200000, avgNet: 235000, forecast90: 705000,
  monthly: [
    { label: "Feb", inflow: 620000, outflow: 500000 },
    { label: "Mar", inflow: 680000, outflow: 460000 },
    { label: "Apr", inflow: 550000, outflow: 580000 },
    { label: "May", inflow: 800000, outflow: 400000 },
    { label: "Jun", inflow: 720000, outflow: 600000 },
    { label: "Jul", inflow: 900000, outflow: 480000 },
    { label: "Aug", inflow: 660000, outflow: 540000 },
    { label: "Sep", inflow: 840000, outflow: 420000 },
  ],
  expenses: [
    { category: "Production", amount: 2304200, pct: 48 },
    { category: "Marketing", amount: 1223000, pct: 25 },
    { category: "Logistics", amount: 540500, pct: 11 },
    { category: "People", amount: 420000, pct: 9 },
    { category: "Operations", amount: 210000, pct: 4 },
    { category: "Other", amount: 120000, pct: 3 },
  ],
};

export default async function CashFlowPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("cashflow");

  const sp = await searchParams;
  const isDate = (v?: string): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const real = await getCashFlowDetails(orgId, { from: isDate(sp.from) ? sp.from : undefined, to: isDate(sp.to) ? sp.to : undefined });
  // Sample preview only when nothing is connected yet (not just an empty window).
  const preview = !(await orgHasConnectors(orgId));

  const realMonthly = real.monthlyData.slice(-8).map((m) => ({
    label: MONTHS[Number(m.month.slice(5, 7)) - 1] ?? m.month, inflow: m.inflow, outflow: m.outflow,
  }));
  const realAvgNet = real.monthlyData.length
    ? real.monthlyData.reduce((s, m) => s + m.net, 0) / real.monthlyData.length
    : 0;

  const v = preview ? SAMPLE : {
    burnRate: real.burnRate, cashBalance: real.cashBalance,
    avgNet: realAvgNet,
    forecast90: real.forecasts.find((f) => f.days === 90)?.projectedBalance ?? 0,
    monthly: realMonthly,
    expenses: real.categoryBreakdown,
  };

  return (
    <div className="space-y-3 max-w-[1400px]">
      {preview && <PreviewBanner />}

      {!preview && (
        <div className="flex items-center justify-end">
          <RangeFilterBar basePath="/dashboard/cashflow" from={real.period.from} to={real.period.to} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter">
        <MetricCard title="Cash Balance" value={formatCurrency(v.cashBalance, "INR", true)}
          icon={<Wallet className="w-4 h-4" />} accentColor="hsl(var(--metric-cash))" />
        <MetricCard title="Burn Rate" value={`${formatCurrency(v.burnRate, "INR", true)}/mo`} subtitle="operating burn"
          icon={<Flame className="w-4 h-4" />} accentColor="hsl(var(--metric-opex))" />
        <MetricCard title="Net Monthly" value={`${v.avgNet >= 0 ? "+" : "-"}${formatCurrency(Math.abs(v.avgNet), "INR", true)}`} subtitle="avg inflow − outflow"
          icon={<ArrowLeftRight className="w-4 h-4" />} accentColor="hsl(var(--metric-profit))" />
        <MetricCard title="90-day Forecast" value={`${v.forecast90 >= 0 ? "+" : "-"}${formatCurrency(Math.abs(v.forecast90), "INR", true)}`} subtitle="projected net"
          icon={<TrendingUp className="w-4 h-4" />} accentColor="hsl(var(--metric-runway))" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-1">
        <SectionCard title="Inflow vs Outflow" subtitle="last 8 months" className="lg:col-span-2"
          action={<span className="text-[11px] text-muted-foreground"><span className="text-primary">●</span> in <span className="text-warning">●</span> out</span>}>
          <InflowOutflowChart data={v.monthly} height={260} />
        </SectionCard>
        <SectionCard title="Expense Breakdown">
          <CategoryChart data={v.expenses} />
        </SectionCard>
      </div>
    </div>
  );
}
