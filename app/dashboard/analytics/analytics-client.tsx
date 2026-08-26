"use client";

import * as React from "react";
import Link from "next/link";
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell, type TooltipProps,
} from "recharts";
import { Sparkles, Zap, TrendingUp, TrendingDown, Wallet, Percent } from "lucide-react";
import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useNavProgress } from "@/components/dashboard/nav-progress";
import type { AnalyticsData } from "@/lib/analytics";

// ─── formatters ────────────────────────────────────────────────────────────
const money = (n: number, compact = true) => formatCurrency(n, "INR", compact);
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${n.toFixed(d)}%`);
const xTick = (v: string) => { try { return format(parseISO(v + "-01"), "MMM"); } catch { return v; } };
const monthName = (v: string) => { try { return format(parseISO(v + "-01"), "MMMM yyyy"); } catch { return v; } };

// Series palette (theme tokens → vivid in light + dark).
const C = {
  gross: "hsl(var(--metric-revenue))",
  net: "hsl(var(--metric-cash))",
  profit: "hsl(var(--metric-profit))",
  expense: "hsl(var(--metric-opex))",
  margin: "hsl(var(--metric-margin))",
  customers: "hsl(var(--chart-2))",
  arpu: "hsl(var(--metric-runway))",
};
const SLICE = [
  "hsl(var(--metric-revenue))", "hsl(var(--metric-cash))", "hsl(var(--metric-margin))",
  "hsl(var(--metric-opex))", "hsl(var(--metric-runway))", "hsl(var(--metric-profit))",
  "hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))",
];

// ─── shared tooltips ─────────────────────────────────────────────────────────
function SeriesTooltip({ active, payload, label, kind = "money" }: TooltipProps<number, string> & { kind?: "money" | "pct" | "count" }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-popover/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl">
      <p className="text-muted-foreground text-[10.5px] font-bold tracking-[0.1em] uppercase mb-1.5">{monthName(String(label))}</p>
      <div className="space-y-1">
        {payload.filter((p) => p.value != null).map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-[12px]">
            <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="num ml-auto font-semibold text-popover-foreground pl-3">
              {kind === "money" ? money(Number(p.value), false) : kind === "pct" ? pct(Number(p.value)) : Number(p.value).toLocaleString("en-IN")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function SliceTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const e = payload[0];
  return (
    <div className="rounded-xl border border-border bg-popover/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl">
      <p className="font-semibold text-popover-foreground text-[12.5px] mb-0.5">{e.name}</p>
      <p className="num text-muted-foreground text-[12px]">{money(Number(e.value), false)}</p>
      <p className="text-muted-foreground/70 text-[11px] mt-0.5">{(e.payload as { pct: number }).pct?.toFixed(1)}% of total</p>
    </div>
  );
}

const AXIS = { fontSize: 10.5, fill: "hsl(var(--muted-foreground))", fontFamily: "inherit" } as const;
const GRID = "hsl(var(--border))";

function Empty({ h = 260 }: { h?: number }) {
  return <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height: h }}>Not enough data yet</div>;
}

// ─── main ──────────────────────────────────────────────────────────────────
export function AnalyticsClient({ data }: { data: AnalyticsData }) {
  const { navigate } = useNavProgress();
  const { points, headline, runway, gatewayRevenue, expenseCategories, paymentHealth } = data;
  const today = new Date().toISOString().slice(0, 10);
  const hasData = points.some((p) => p.grossRevenue || p.expenses);

  // Stacked expense series: top 6 categories + "Other".
  const topCats = expenseCategories.slice(0, 6);
  const otherCats = expenseCategories.slice(6);
  const stacked = data.months.map((m) => {
    const row: Record<string, number | string> = { month: m };
    for (const c of topCats) row[c.label] = c.monthly[m] ?? 0;
    if (otherCats.length) row["Other"] = otherCats.reduce((a, c) => a + (c.monthly[m] ?? 0), 0);
    return row;
  });
  const stackKeys = [...topCats.map((c) => c.label), ...(otherCats.length ? ["Other"] : [])];

  const expenseMix = expenseCategories.slice(0, 9).map((c, i) => ({
    name: c.label, amount: c.total,
    pct: (c.total / (expenseCategories.reduce((a, x) => a + x.total, 0) || 1)) * 100,
    fill: SLICE[i % SLICE.length],
  }));

  const healthData = [
    { name: "Completed", value: paymentHealth.completed, pct: 0, fill: "hsl(var(--metric-profit))" },
    { name: "Failed", value: paymentHealth.failed, pct: 0, fill: "hsl(var(--metric-opex))" },
    { name: "Refunded", value: paymentHealth.refunded, pct: 0, fill: "hsl(var(--chart-2))" },
    { name: "Pending", value: paymentHealth.pending, pct: 0, fill: "hsl(var(--metric-runway))" },
  ].filter((d) => d.value > 0);
  const healthTotal = healthData.reduce((a, d) => a + d.value, 0) || 1;
  healthData.forEach((d) => (d.pct = (d.value / healthTotal) * 100));
  const successRate = paymentHealth.completed + paymentHealth.failed > 0
    ? (paymentHealth.completed / (paymentHealth.completed + paymentHealth.failed)) * 100 : null;

  const runwayLabel = runway.runwayDays >= 9999 ? "∞" : runway.runwayDays >= 365 ? `${(runway.runwayDays / 365).toFixed(1)} yr` : runway.runwayDays >= 60 ? `${Math.round(runway.runwayDays / 30)} mo` : `${runway.runwayDays} d`;

  return (
    <div className="space-y-3 max-w-[1400px]">
      <PageHeader title="Analytics" subtitle={`Revenue, expenses & profitability · ${data.periodLabel}`}>
        <DateRangePicker from={data.from} to={data.to} max={today} align="end" onChange={(f, t) => navigate(`/dashboard/analytics?from=${f}&to=${t}`)} />
      </PageHeader>

      {data.preview && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-[12.5px] text-foreground/80 flex-1 min-w-0"><span className="font-semibold text-foreground">Preview — sample data.</span> Connect a source to see your real analytics.</p>
          <Link href="/dashboard/connectors" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0"><Zap className="h-3.5 w-3.5" /> Connect</Link>
        </div>
      )}

      {/* Headline */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 animate-enter">
        <MetricCard title="Net Revenue" value={money(headline.netRevenue)} icon={<TrendingUp className="size-4" />} accentColor="#10b981" subtitle="Gross − refunds − chargebacks" />
        <MetricCard title="Net Profit" value={money(headline.netProfit)} icon={headline.netProfit >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />} accentColor={headline.netProfit >= 0 ? "#10b981" : "#f43f5e"} subtitle="After all operating expenses" />
        <MetricCard title="Net Margin" value={pct(headline.netMargin)} icon={<Percent className="size-4" />} accentColor="#6366f1" subtitle="Net profit ÷ net revenue" />
        <MetricCard title="Avg MoM Growth" value={pct(headline.avgMonthlyGrowth)} icon={headline.avgMonthlyGrowth && headline.avgMonthlyGrowth < 0 ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />} accentColor={headline.avgMonthlyGrowth && headline.avgMonthlyGrowth < 0 ? "#f43f5e" : "#10b981"} subtitle="Net revenue, month over month" />
        <MetricCard title="Runway" value={runwayLabel} icon={<Wallet className="size-4" />} severity={runway.runwayDays <= 120 ? "warning" : undefined} subtitle="Cash ÷ monthly burn" />
      </div>

      {!hasData && !data.preview ? (
        <SectionCard title="Analytics" subtitle="">
          <div className="py-16 text-center text-sm text-muted-foreground">No transactions in this range yet. Widen the date range or connect a source.</div>
        </SectionCard>
      ) : (
      <>
      {/* Revenue */}
      <div className="grid lg:grid-cols-2 gap-3 animate-enter-1">
        <SectionCard title="Revenue trend" subtitle="Gross vs net revenue by month">
          {hasData ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeOpacity={0.5} />
                <XAxis dataKey="month" tickFormatter={xTick} tick={AXIS} axisLine={false} tickLine={false} dy={6} />
                <YAxis tickFormatter={(v) => money(v)} tick={AXIS} axisLine={false} tickLine={false} width={54} />
                <Tooltip content={<SeriesTooltip kind="money" />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.06)" }} />
                <Area type="monotone" dataKey="grossRevenue" name="Gross" stroke={C.gross} fill={C.gross} fillOpacity={0.12} strokeWidth={1.5} />
                <Line type="monotone" dataKey="netRevenue" name="Net" stroke={C.net} strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </SectionCard>

        <SectionCard title="Revenue by gateway" subtitle="Share of gross revenue in range">
          {gatewayRevenue.length ? (
            <div className="flex items-center gap-4 h-[260px]">
              <div className="relative h-[150px] w-[150px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={gatewayRevenue} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="amount" nameKey="name" paddingAngle={2} strokeWidth={0}>
                      {gatewayRevenue.map((_, i) => <Cell key={i} fill={SLICE[i % SLICE.length]} />)}
                    </Pie>
                    <Tooltip content={<SliceTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium text-muted-foreground">Revenue</span>
              </div>
              <ul className="flex-1 min-w-0 flex flex-col gap-1.5 text-xs overflow-y-auto max-h-[240px]">
                {gatewayRevenue.map((g, i) => (
                  <li key={g.name} className="flex items-center gap-2 min-w-0">
                    <span className="inline-block h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: SLICE[i % SLICE.length] }} />
                    <span className="truncate text-muted-foreground">{g.name}</span>
                    <span className="num ml-auto text-foreground/80 font-medium pl-2 flex-shrink-0">{money(g.amount)}</span>
                    <span className="num text-muted-foreground w-12 text-right flex-shrink-0">{g.pct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <Empty />}
        </SectionCard>
      </div>

      {/* Profitability */}
      <div className="grid lg:grid-cols-2 gap-3 animate-enter-1">
        <SectionCard title="Revenue vs burn" subtitle="Net revenue, expenses & net profit by month">
          {hasData ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeOpacity={0.5} />
                <XAxis dataKey="month" tickFormatter={xTick} tick={AXIS} axisLine={false} tickLine={false} dy={6} />
                <YAxis tickFormatter={(v) => money(v)} tick={AXIS} axisLine={false} tickLine={false} width={54} />
                <Tooltip content={<SeriesTooltip kind="money" />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.06)" }} />
                <Bar dataKey="netRevenue" name="Net revenue" fill={C.net} radius={[3, 3, 0, 0]} barSize={12} />
                <Bar dataKey="expenses" name="Expenses" fill={C.expense} radius={[3, 3, 0, 0]} barSize={12} />
                <Line type="monotone" dataKey="netProfit" name="Net profit" stroke={C.profit} strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </SectionCard>

        <SectionCard title="Net margin" subtitle="Net profit as % of net revenue">
          {hasData ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeOpacity={0.5} />
                <XAxis dataKey="month" tickFormatter={xTick} tick={AXIS} axisLine={false} tickLine={false} dy={6} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={AXIS} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<SeriesTooltip kind="pct" />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.06)" }} />
                <Area type="monotone" dataKey="netMargin" name="Net margin" stroke={C.margin} fill={C.margin} fillOpacity={0.12} strokeWidth={2.2} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </SectionCard>
      </div>

      {/* Expenses */}
      <div className="grid lg:grid-cols-2 gap-3 animate-enter-2">
        <SectionCard title="Expenses by category over time" subtitle="Top categories, stacked by month">
          {stackKeys.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={stacked} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeOpacity={0.5} />
                <XAxis dataKey="month" tickFormatter={xTick} tick={AXIS} axisLine={false} tickLine={false} dy={6} />
                <YAxis tickFormatter={(v) => money(v)} tick={AXIS} axisLine={false} tickLine={false} width={54} />
                <Tooltip content={<SeriesTooltip kind="money" />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.06)" }} />
                {stackKeys.map((k, i) => (
                  <Bar key={k} dataKey={k} name={k} stackId="e" fill={SLICE[i % SLICE.length]} radius={i === stackKeys.length - 1 ? [3, 3, 0, 0] : undefined} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty h={280} />}
        </SectionCard>

        <SectionCard title="Expense mix" subtitle="Share of total spend in range">
          {expenseMix.length ? (
            <div className="flex items-center gap-4 h-[280px]">
              <div className="relative h-[150px] w-[150px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expenseMix} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="amount" nameKey="name" paddingAngle={2} strokeWidth={0}>
                      {expenseMix.map((s, i) => <Cell key={i} fill={s.fill} />)}
                    </Pie>
                    <Tooltip content={<SliceTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium text-muted-foreground">Spend</span>
              </div>
              <ul className="flex-1 min-w-0 flex flex-col gap-1.5 text-xs overflow-y-auto max-h-[260px]">
                {expenseMix.map((s, i) => (
                  <li key={s.name} className="flex items-center gap-2 min-w-0">
                    <span className="inline-block h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: SLICE[i % SLICE.length] }} />
                    <span className="truncate text-muted-foreground">{s.name}</span>
                    <span className="num ml-auto text-foreground/80 font-medium pl-2 flex-shrink-0">{money(s.amount)}</span>
                    <span className="num text-muted-foreground w-12 text-right flex-shrink-0">{s.pct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <Empty h={280} />}
        </SectionCard>
      </div>

      {/* Customers */}
      <div className="grid lg:grid-cols-2 gap-3 animate-enter-2">
        <SectionCard title="Customers & ARPU" subtitle="Paying customers + average revenue per customer">
          {hasData ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeOpacity={0.5} />
                <XAxis dataKey="month" tickFormatter={xTick} tick={AXIS} axisLine={false} tickLine={false} dy={6} />
                <YAxis yAxisId="c" tick={AXIS} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
                <YAxis yAxisId="a" orientation="right" tick={AXIS} axisLine={false} tickLine={false} width={48} tickFormatter={(v) => money(v)} />
                <Tooltip content={<SeriesTooltip kind="count" />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.06)" }} />
                <Bar yAxisId="c" dataKey="payingCustomers" name="Customers" fill={C.customers} radius={[3, 3, 0, 0]} barSize={16} />
                <Line yAxisId="a" type="monotone" dataKey="arpu" name="ARPU" stroke={C.arpu} strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </SectionCard>

        <SectionCard title="Refund & chargeback rate" subtitle="As % of gross revenue by month">
          {hasData ? (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeOpacity={0.5} />
                <XAxis dataKey="month" tickFormatter={xTick} tick={AXIS} axisLine={false} tickLine={false} dy={6} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={AXIS} axisLine={false} tickLine={false} width={40} />
                <Tooltip content={<SeriesTooltip kind="pct" />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.06)" }} />
                <Line type="monotone" dataKey="refundRate" name="Refund rate" stroke={C.expense} strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="chargebackRate" name="Chargeback rate" stroke={C.margin} strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </SectionCard>
      </div>

      {/* Payment outcomes */}
      <div className="grid lg:grid-cols-2 gap-3 animate-enter-2">
        <SectionCard title="Payment outcomes" subtitle={successRate != null ? `${successRate.toFixed(1)}% success rate (completed vs failed)` : "Transaction outcomes in range"}>
          {healthData.length ? (
            <div className="flex items-center gap-4 h-[240px]">
              <div className="relative h-[140px] w-[140px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={healthData} cx="50%" cy="50%" innerRadius={44} outerRadius={66} dataKey="value" nameKey="name" paddingAngle={2} strokeWidth={0}>
                      {healthData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip content={<SliceTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium text-muted-foreground">Txns</span>
              </div>
              <ul className="flex-1 min-w-0 flex flex-col gap-1.5 text-xs">
                {healthData.map((d) => (
                  <li key={d.name} className="flex items-center gap-2 min-w-0">
                    <span className="inline-block h-2 w-2 rounded-sm flex-shrink-0" style={{ backgroundColor: d.fill }} />
                    <span className="truncate text-muted-foreground">{d.name}</span>
                    <span className="num ml-auto text-foreground/80 font-medium pl-2 flex-shrink-0">{d.value.toLocaleString("en-IN")}</span>
                    <span className="num text-muted-foreground w-12 text-right flex-shrink-0">{d.pct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <Empty h={240} />}
        </SectionCard>

        <SectionCard title="Profit trend" subtitle="Net operating income vs net profit by month">
          {hasData ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={GRID} strokeOpacity={0.5} />
                <XAxis dataKey="month" tickFormatter={xTick} tick={AXIS} axisLine={false} tickLine={false} dy={6} />
                <YAxis tickFormatter={(v) => money(v)} tick={AXIS} axisLine={false} tickLine={false} width={54} />
                <Tooltip content={<SeriesTooltip kind="money" />} cursor={{ fill: "hsl(var(--muted-foreground) / 0.06)" }} />
                <Line type="monotone" dataKey="netOperatingIncome" name="Operating income" stroke={C.margin} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="netProfit" name="Net profit" stroke={C.profit} strokeWidth={2.2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty h={240} />}
        </SectionCard>
      </div>
      </>
      )}

      <p className="text-[11px] text-muted-foreground px-1">
        Revenue, margins & expenses tie to your <Link href="/dashboard/pnl" className="underline decoration-dotted hover:text-foreground">P&L</Link>.
        All figures computed from the same fast rollups — no raw-table scans.
      </p>
    </div>
  );
}
