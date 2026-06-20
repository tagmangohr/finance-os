export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { TrendingUp, Coins, ArrowUpRight, Percent } from "lucide-react";
import { getOrgId, getRevenueDetails, orgHasConnectors } from "@/lib/data";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { PreviewBanner } from "@/components/dashboard/preview-banner";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { formatCurrency } from "@/lib/utils";

type CustomerLite = { name: string; total_revenue: number };

const SAMPLE = {
  mrr: 820000, arr: 9840000, momGrowth: 12, yoyGrowth: 64,
  revenueByMonth: [
    { month: "2024-07", amount: 520000 }, { month: "2024-08", amount: 560000 },
    { month: "2024-09", amount: 540000 }, { month: "2024-10", amount: 600000 },
    { month: "2024-11", amount: 640000 }, { month: "2024-12", amount: 700000 },
    { month: "2025-01", amount: 680000 }, { month: "2025-02", amount: 720000 },
    { month: "2025-03", amount: 760000 }, { month: "2025-04", amount: 790000 },
    { month: "2025-05", amount: 800000 }, { month: "2025-06", amount: 820000 },
  ],
  customers: [
    { name: "Acme Corp", total_revenue: 2400000 },
    { name: "Globex", total_revenue: 1850000 },
    { name: "Initech", total_revenue: 1320000 },
    { name: "Umbrella Co", total_revenue: 980000 },
    { name: "Soylent", total_revenue: 640000 },
  ] as CustomerLite[],
  currencyBreakdown: [
    { currency: "INR", original: 4200000, inr: 4200000 },
    { currency: "USD", original: 42000, inr: 3520000 },
    { currency: "EUR", original: 9000, inr: 820000 },
  ],
};

export default async function RevenuePage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const real = await getRevenueDetails(orgId);
  // Sample preview only when nothing is connected yet — a connected org sees its
  // real data (even if this window is empty), never fabricated numbers.
  const preview = !(await orgHasConnectors(orgId));
  const v = preview ? SAMPLE : {
    mrr: real.mrr, arr: real.arr, momGrowth: real.momGrowth, yoyGrowth: real.yoyGrowth,
    revenueByMonth: real.revenueByMonth,
    customers: (real.customers as unknown as CustomerLite[]).map((c) => ({
      name: c.name, total_revenue: c.total_revenue ?? 0,
    })),
    currencyBreakdown: real.currencyBreakdown,
  };

  const mrrSpark = v.revenueByMonth.slice(-8).map((r) => r.amount);
  const maxRev = Math.max(...v.customers.map((c) => c.total_revenue), 1);

  return (
    <div className="space-y-3 max-w-[1400px]">
      {preview && <PreviewBanner />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter">
        <MetricCard title="MRR" value={formatCurrency(v.mrr, "INR", true)}
          trend={v.momGrowth || undefined} trendLabel="MoM"
          icon={<TrendingUp className="w-4 h-4" />} accentColor="hsl(var(--metric-revenue))"
          sparklineData={mrrSpark.length >= 2 ? mrrSpark : undefined} />
        <MetricCard title="ARR" value={formatCurrency(v.arr, "INR", true)} subtitle="Annual run rate"
          icon={<Coins className="w-4 h-4" />} accentColor="hsl(var(--metric-profit))" />
        <MetricCard title="MoM Growth" value={`${v.momGrowth > 0 ? "+" : ""}${v.momGrowth.toFixed(1)}%`} subtitle="month over month"
          icon={<ArrowUpRight className="w-4 h-4" />} accentColor="hsl(var(--metric-cash))" />
        <MetricCard title="YoY Growth" value={`${v.yoyGrowth > 0 ? "+" : ""}${v.yoyGrowth.toFixed(0)}%`} subtitle="year over year"
          icon={<Percent className="w-4 h-4" />} accentColor="hsl(var(--metric-margin))" />
      </div>

      {v.currencyBreakdown.length > 1 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3 animate-enter flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            Collections by currency
          </span>
          {v.currencyBreakdown.map((c) => (
            <div key={c.currency} className="flex items-baseline gap-1.5 text-[12px]">
              <span className="font-semibold text-foreground/80">{c.currency}</span>
              <span className="num text-foreground/70">{formatCurrency(c.original, c.currency, false)}</span>
              {c.currency !== "INR" && (
                <span className="num text-[11px] text-muted-foreground/70">≈ {formatCurrency(c.inr, "INR", true)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-1">
        <SectionCard title="Revenue" subtitle="last 12 months" className="lg:col-span-2">
          <RevenueChart data={v.revenueByMonth} />
        </SectionCard>
        <SectionCard title="Top Customers">
          {v.customers.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-[12px] text-muted-foreground">No customers yet</div>
          ) : (
            <div className="space-y-2.5 mt-1">
              {v.customers.slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="text-[11px] text-muted-foreground/70 w-3 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[12px] text-foreground/80 truncate">{c.name}</span>
                      <span className="num text-[11.5px] font-semibold text-foreground/70 flex-shrink-0">{formatCurrency(c.total_revenue, "INR", true)}</span>
                    </div>
                    <span className="block h-1.5 rounded-full bg-accent overflow-hidden">
                      <span className="block h-full rounded-full bg-metric-revenue" style={{ width: `${(c.total_revenue / maxRev) * 100}%` }} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
