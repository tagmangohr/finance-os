export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { TrendingUp, Coins, ArrowUpRight, Percent, Wallet } from "lucide-react";
import { getOrgId, getRevenueDetails, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import { createClient } from "@/lib/supabase/server";
import { getCardPrefs, EMPTY_CARD_PREFS } from "@/lib/cards/prefs";
import { MetricCard } from "@/components/dashboard/metric-card";
import { CustomizableCards, type CardItem } from "@/components/dashboard/customizable-cards";
import { SectionCard } from "@/components/dashboard/section-card";
import { PreviewBanner } from "@/components/dashboard/preview-banner";
import { RangeFilterBar } from "@/components/dashboard/range-filter-bar";
import { RevenueChart } from "@/components/charts/lazy";
import { RevenueCustomers } from "@/components/dashboard/revenue-customers";
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
    totalRevenue: real.totalRevenue, revenueByMonth: real.revenueByMonth,
  };

  // Per-user card layout (order + hidden) for this tab; empty until migration 121.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const cardPrefs = user ? await getCardPrefs(user.id, orgId, "revenue", supabase) : EMPTY_CARD_PREFS;

  const cards: CardItem[] = [
    { key: "total", label: "Total Revenue", node: (
      <MetricCard title="Total Revenue" value={formatCurrency(v.totalRevenue, "INR", true)} numericValue={v.totalRevenue} format="currency" subtitle="collected in range"
        icon={<Wallet className="w-4 h-4" />} accentColor="hsl(var(--metric-revenue))" />
    ) },
    { key: "mrr", label: "MRR", node: (
      <MetricCard title="MRR" value={formatCurrency(v.mrr, "INR", true)} numericValue={v.mrr} format="currency" subtitle="avg last 3 months"
        icon={<TrendingUp className="w-4 h-4" />} accentColor="hsl(var(--metric-cash))" />
    ) },
    { key: "arr", label: "ARR", node: (
      <MetricCard title="ARR" value={formatCurrency(v.arr, "INR", true)} numericValue={v.arr} format="currency" subtitle="annual run rate"
        icon={<Coins className="w-4 h-4" />} accentColor="hsl(var(--metric-profit))" />
    ) },
    { key: "mom", label: "MoM Growth", node: (
      <MetricCard title="MoM Growth" value={`${v.momGrowth > 0 ? "+" : ""}${v.momGrowth.toFixed(1)}%`} numericValue={v.momGrowth} format="percent" subtitle="month over month"
        icon={<ArrowUpRight className="w-4 h-4" />} accentColor="hsl(var(--metric-cash))" />
    ) },
    { key: "yoy", label: "YoY Growth", node: (
      <MetricCard title="YoY Growth" value={`${v.yoyGrowth > 0 ? "+" : ""}${v.yoyGrowth.toFixed(0)}%`} numericValue={v.yoyGrowth} format="percent" subtitle="year over year"
        icon={<Percent className="w-4 h-4" />} accentColor="hsl(var(--metric-margin))" />
    ) },
  ];

  return (
    <div className="space-y-3 max-w-[1400px]">
      {preview && <PreviewBanner />}

      {!preview && (
        <div className="flex items-center justify-end">
          <RangeFilterBar basePath="/dashboard/revenue" from={real.period.from} to={real.period.to} />
        </div>
      )}

      <div className="animate-enter">
        <CustomizableCards
          tab="revenue"
          orgId={orgId}
          cards={cards}
          initialOrder={cardPrefs.order}
          initialHidden={cardPrefs.hidden}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-1">
        <SectionCard title="Revenue" subtitle="monthly, selected range" className="lg:col-span-2">
          <RevenueChart data={v.revenueByMonth} />
        </SectionCard>
        {/* Top customers loads async (live aggregation can be slow on wide ranges)
            so it never blocks the cards + chart above. */}
        <RevenueCustomers
          orgId={orgId}
          from={real.period.from}
          to={real.period.to}
          totalRevenue={v.totalRevenue}
          preview={preview}
          sampleTop={SAMPLE.customers}
          samplePaying={SAMPLE.payingCustomers}
        />
      </div>
    </div>
  );
}
