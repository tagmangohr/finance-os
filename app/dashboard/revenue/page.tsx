export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { TrendingUp, Coins, ArrowUpRight, Percent, Wallet, Users, Gauge } from "lucide-react";
import { getOrgId, getRevenueDetails, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { PreviewBanner } from "@/components/dashboard/preview-banner";
import { RangeFilterBar } from "@/components/dashboard/range-filter-bar";
import { RevenueChart } from "@/components/charts/lazy";
import { formatCurrency } from "@/lib/utils";

type CustomerLite = { name: string; total_revenue: number; txns: number };

const SAMPLE = {
  mrr: 820000, arr: 9840000, momGrowth: 12, yoyGrowth: 64,
  totalRevenue: 8760000, payingCustomers: 1284,
  revenueByMonth: [
    { month: "2024-07", amount: 520000 }, { month: "2024-08", amount: 560000 },
    { month: "2024-09", amount: 540000 }, { month: "2024-10", amount: 600000 },
    { month: "2024-11", amount: 640000 }, { month: "2024-12", amount: 700000 },
    { month: "2025-01", amount: 680000 }, { month: "2025-02", amount: 720000 },
    { month: "2025-03", amount: 760000 }, { month: "2025-04", amount: 790000 },
    { month: "2025-05", amount: 800000 }, { month: "2025-06", amount: 820000 },
  ],
  customers: [
    { name: "Acme Corp", total_revenue: 2400000, txns: 48 },
    { name: "Globex", total_revenue: 1850000, txns: 31 },
    { name: "Initech", total_revenue: 1320000, txns: 22 },
    { name: "Umbrella Co", total_revenue: 980000, txns: 17 },
    { name: "Soylent", total_revenue: 640000, txns: 11 },
  ] as CustomerLite[],
};

export default async function RevenuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  await requireRouteAccess("revenue");

  const sp = await searchParams;
  const isDate = (v?: string): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const real = await getRevenueDetails(orgId, { from: isDate(sp.from) ? sp.from : undefined, to: isDate(sp.to) ? sp.to : undefined });
  // Sample preview only when nothing is connected yet — a connected org sees its
  // real data (even if this window is empty), never fabricated numbers.
  const preview = !(await orgHasConnectors(orgId));
  const v = preview ? SAMPLE : {
    mrr: real.mrr, arr: real.arr, momGrowth: real.momGrowth, yoyGrowth: real.yoyGrowth,
    totalRevenue: real.totalRevenue, payingCustomers: real.payingCustomers,
    revenueByMonth: real.revenueByMonth,
    customers: (real.customers as unknown as CustomerLite[]).map((c) => ({
      name: c.name, total_revenue: c.total_revenue ?? 0, txns: c.txns ?? 0,
    })),
  };

  const maxRev = Math.max(...v.customers.map((c) => c.total_revenue), 1);
  const avgPerCustomer = v.payingCustomers > 0 ? v.totalRevenue / v.payingCustomers : 0;
  // Compact count: readable up to 99,999 then abbreviated (1.2L, 3.4Cr).
  const compactCount = (n: number) =>
    n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n.toLocaleString("en-IN");

  return (
    <div className="space-y-3 max-w-[1400px]">
      {preview && <PreviewBanner />}

      {!preview && (
        <div className="flex items-center justify-end">
          <RangeFilterBar basePath="/dashboard/revenue" from={real.period.from} to={real.period.to} />
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter">
        <MetricCard title="Total Revenue" value={formatCurrency(v.totalRevenue, "INR", true)} subtitle="collected in range"
          icon={<Wallet className="w-4 h-4" />} accentColor="hsl(var(--metric-revenue))" />
        <MetricCard title="MRR" value={formatCurrency(v.mrr, "INR", true)} subtitle="avg last 3 months"
          icon={<TrendingUp className="w-4 h-4" />} accentColor="hsl(var(--metric-cash))" />
        <MetricCard title="ARR" value={formatCurrency(v.arr, "INR", true)} subtitle="annual run rate"
          icon={<Coins className="w-4 h-4" />} accentColor="hsl(var(--metric-profit))" />
        <MetricCard title="Paying Customers" value={v.payingCustomers > 0 ? compactCount(v.payingCustomers) : "—"} subtitle="unique in range"
          icon={<Users className="w-4 h-4" />} accentColor="hsl(var(--metric-margin))" />
        <MetricCard title="Avg / Customer" value={avgPerCustomer > 0 ? formatCurrency(avgPerCustomer, "INR", true) : "—"} subtitle="revenue per customer"
          icon={<Gauge className="w-4 h-4" />} accentColor="hsl(var(--metric-revenue))" />
        <MetricCard title="MoM Growth" value={`${v.momGrowth > 0 ? "+" : ""}${v.momGrowth.toFixed(1)}%`} subtitle="month over month"
          icon={<ArrowUpRight className="w-4 h-4" />} accentColor="hsl(var(--metric-cash))" />
        <MetricCard title="YoY Growth" value={`${v.yoyGrowth > 0 ? "+" : ""}${v.yoyGrowth.toFixed(0)}%`} subtitle="year over year"
          icon={<Percent className="w-4 h-4" />} accentColor="hsl(var(--metric-margin))" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-1">
        <SectionCard title="Revenue" subtitle="last 12 months" className="lg:col-span-2">
          <RevenueChart data={v.revenueByMonth} />
        </SectionCard>
        <SectionCard title="Top Customers" subtitle="by revenue in range">
          {v.customers.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-[12px] text-muted-foreground">No customers yet</div>
          ) : (
            <div className="space-y-3 mt-1">
              {v.customers.slice(0, 5).map((c, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="num text-[11px] font-semibold text-muted-foreground/70 w-3.5 flex-shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[12px] text-foreground/80 truncate">{c.name}</span>
                      <span className="num text-[11.5px] font-semibold text-foreground flex-shrink-0">{formatCurrency(c.total_revenue, "INR", true)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="block flex-1 h-1.5 rounded-full bg-accent overflow-hidden">
                        <span className="block h-full rounded-full bg-metric-revenue" style={{ width: `${(c.total_revenue / maxRev) * 100}%` }} />
                      </span>
                      {c.txns > 0 && (
                        <span className="num text-[10px] text-muted-foreground/70 flex-shrink-0 tabular-nums">{c.txns.toLocaleString("en-IN")} txns</span>
                      )}
                    </div>
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
