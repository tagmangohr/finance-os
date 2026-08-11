"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { Download, Search, Repeat, TrendingUp, AlertTriangle, Users, IndianRupee, Activity, HeartPulse } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { SubscriptionsOverview } from "@/lib/subscriptions/reports";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const nfmt = (n: number) => n.toLocaleString("en-IN");
const inr = (n: number) => formatCurrency(n, "INR", true);
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

const GATEWAY_LABEL: Record<string, string> = {
  cashfree: "Cashfree", stripe: "Stripe", razorpay: "Razorpay", app_store: "Apple Pay",
  payu: "PayU", paytm: "Paytm", easebuzz: "Easebuzz",
};
const gwLabel = (g: string) => GATEWAY_LABEL[g] ?? g;
const monthLabel = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

function money(amount: unknown, currency: unknown) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a === 0) return "—";
  return formatCurrency(a, (currency as string) || "INR");
}

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600",
  past_due: "bg-amber-500/15 text-amber-600",
  cancelled: "bg-rose-500/15 text-rose-600",
  expired: "bg-neutral-500/15 text-neutral-500",
  paused: "bg-sky-500/15 text-sky-600",
};

export function SubscriptionsClient({ data }: { data: SubscriptionsOverview }) {
  const { now, kpis, byGateway, monthly, cohorts, cohortPeriods, topPlans, grace } = data;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"active" | "pastDue">("active");
  const [q, setQ] = useState("");

  const rows = tab === "active" ? data.previewActive : data.previewPastDue;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.customer_name, r.customer_email, r.customer_phone, r.plan_name, r.subscription_id, r.gateway].some((v) => s(v).toLowerCase().includes(t))
    );
  }, [rows, q]);

  const setGrace = (g: number) => startTransition(() => router.push(`?grace=${g}`));

  // Chart series (drop the very first month — it's the seed with no prior).
  const chart = monthly.map((m) => ({
    month: monthLabel(m.month),
    MRR: m.mrr,
    "New MRR": m.newMrr,
    "Churned MRR": -m.churnedMrr,
  }));

  const exportHref = (report: string, format: string) => `/api/subscriptions/export?report=${report}&format=${format}&grace=${grace}`;

  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-xs text-muted-foreground">Recurring revenue across all gateways · MRR/ARR are current run-rate, movement is month-wise</p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Revival window
          <select
            value={grace}
            onChange={(e) => setGrace(Number(e.target.value))}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          >
            {[3, 6, 12, 24].map((g) => <option key={g} value={g}>{g} months</option>)}
          </select>
          {pending && <span className="text-[10px]">updating…</span>}
        </label>
      </div>

      {/* KPI strip — revenue */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter">
        <MetricCard title="MRR" value={inr(now.active.mrr)} icon={<IndianRupee className="size-4" />} accentColor="#10b981" subtitle="Active run-rate" />
        <MetricCard title="ARR" value={inr(now.arr)} icon={<TrendingUp className="size-4" />} subtitle="MRR × 12" />
        <MetricCard title="Net-new MRR" value={inr(kpis.netNewMrr)} icon={<Activity className="size-4" />} trend={kpis.mrrGrowthPct ?? undefined} trendLabel="MoM" subtitle="vs last complete month" accentColor="#6366f1" />
        <MetricCard title="ARPU" value={formatCurrency(now.arpu, "INR")} icon={<Users className="size-4" />} subtitle="MRR ÷ active" />
      </div>
      {/* KPI strip — health */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter-1">
        <MetricCard title="Active subscriptions" value={nfmt(now.active.subs)} icon={<Repeat className="size-4" />} subtitle={`${nfmt(now.totalCustomers)} incl. past-due`} />
        <MetricCard title="Past due (revivable)" value={nfmt(now.pastDue.subs)} icon={<AlertTriangle className="size-4" />} accentColor="#f59e0b" subtitle={`${inr(now.pastDue.mrr)} recoverable · ${grace}mo window`} />
        <MetricCard title="Logo churn" value={pct(kpis.logoChurnPct)} icon={<Activity className="size-4" />} accentColor="#ef4444" subtitle="last complete month" />
        <MetricCard title="Net revenue retention" value={pct(kpis.nrrPct)} icon={<HeartPulse className="size-4" />} accentColor="#8b5cf6" subtitle="rev-churn basis (expansion soon)" />
      </div>

      {/* Growth over time */}
      <SectionCard title="Growth over time" subtitle="Active MRR (line) with new vs churned MRR (bars), by month"
        action={
          <div className="flex items-center gap-2">
            <a href={exportHref("monthly", "csv")} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />Month-wise</a>
            <a href={exportHref("gateway", "csv")} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />By gateway</a>
          </div>
        }>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis yAxisId="mrr" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => inr(Number(v))} width={64} />
              <YAxis yAxisId="mv" orientation="right" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => inr(Number(v))} width={64} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}
                formatter={(v: number, n) => [inr(Math.abs(v)), n]}
              />
              <ReferenceLine yAxisId="mv" y={0} stroke="hsl(var(--border))" />
              <Bar yAxisId="mv" dataKey="New MRR" fill="#10b981" radius={[2, 2, 0, 0]} maxBarSize={22} />
              <Bar yAxisId="mv" dataKey="Churned MRR" fill="#ef4444" radius={[0, 0, 2, 2]} maxBarSize={22} />
              <Line yAxisId="mrr" type="monotone" dataKey="MRR" stroke="#6366f1" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50 sticky top-0 bg-background">
              <th className="py-1.5 font-medium">Month</th><th className="font-medium text-right">Active</th><th className="font-medium text-right">MRR</th>
              <th className="font-medium text-right">New</th><th className="font-medium text-right">Churned</th><th className="font-medium text-right">Net-new MRR</th>
              <th className="font-medium text-right">Past-due</th><th className="font-medium text-right">Renewals ₹</th>
            </tr></thead>
            <tbody>
              {[...monthly].reverse().map((m) => (
                <tr key={m.month} className="border-b border-border/30">
                  <td className="py-1.5">{monthLabel(m.month)}</td>
                  <td className="text-right tabular-nums">{nfmt(m.active)}</td>
                  <td className="text-right tabular-nums">{inr(m.mrr)}</td>
                  <td className="text-right tabular-nums text-emerald-600">+{nfmt(m.newSubs)}</td>
                  <td className="text-right tabular-nums text-rose-600">−{nfmt(m.churnedSubs)}</td>
                  <td className={cn("text-right tabular-nums", m.netNewMrr >= 0 ? "text-emerald-600" : "text-rose-600")}>{inr(m.netNewMrr)}</td>
                  <td className="text-right tabular-nums text-amber-600">{nfmt(m.pastDue)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{inr(m.renewalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* By gateway */}
        <SectionCard title="By gateway" subtitle="Current active, recoverable & churned">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50">
              <th className="py-1.5 font-medium">Gateway</th><th className="font-medium text-right">Active</th><th className="font-medium text-right">MRR</th>
              <th className="font-medium text-right">Past-due</th><th className="font-medium text-right">Recoverable</th><th className="font-medium text-right">Churned</th>
            </tr></thead>
            <tbody>
              {byGateway.map((g) => (
                <tr key={g.gateway} className="border-b border-border/30">
                  <td className="py-1.5">{gwLabel(g.gateway)}</td>
                  <td className="text-right tabular-nums">{nfmt(g.active)}</td>
                  <td className="text-right tabular-nums">{inr(g.activeMrr)}</td>
                  <td className="text-right tabular-nums text-amber-600">{nfmt(g.pastDue)}</td>
                  <td className="text-right tabular-nums text-amber-600">{inr(g.pastDueMrr)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{nfmt(g.churned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        {/* Top plans */}
        <SectionCard title="Top plans" subtitle="Active MRR by plan">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border/50 sticky top-0 bg-background">
                <th className="py-1.5 font-medium">Plan</th><th className="font-medium">Gateway</th><th className="font-medium text-right">Active</th><th className="font-medium text-right">MRR</th>
              </tr></thead>
              <tbody>
                {topPlans.map((p, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1.5 max-w-[200px] truncate" title={p.plan}>{p.plan}</td>
                    <td className="text-muted-foreground">{gwLabel(p.gateway)}</td>
                    <td className="text-right tabular-nums">{nfmt(p.active)}</td>
                    <td className="text-right tabular-nums">{inr(p.mrr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* Cohort retention */}
      <SectionCard title="Cohort retention" subtitle={`% of each start-month cohort still active after N months (revival window ${grace}mo)`}>
        <div className="overflow-auto">
          <table className="text-xs border-separate border-spacing-0.5">
            <thead><tr className="text-muted-foreground">
              <th className="text-left font-medium px-2 py-1">Cohort</th>
              <th className="text-right font-medium px-2 py-1">Size</th>
              {Array.from({ length: cohortPeriods + 1 }, (_, k) => <th key={k} className="text-center font-medium px-1 py-1">M{k}</th>)}
            </tr></thead>
            <tbody>
              {[...cohorts].reverse().map((c) => (
                <tr key={c.cohort}>
                  <td className="px-2 py-1 whitespace-nowrap">{monthLabel(c.cohort)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{nfmt(c.size)}</td>
                  {c.pct.map((p, k) => (
                    <td key={k} className="px-1 py-1 text-center tabular-nums rounded"
                      style={p == null ? undefined : { background: `color-mix(in srgb, #10b981 ${Math.round(p * 0.8)}%, transparent)`, color: p > 55 ? "white" : "inherit" }}>
                      {p == null ? "" : Math.round(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Customer preview */}
      <SectionCard
        title="Customers"
        subtitle="Top 100 by MRR — full filtered data via export"
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer / plan / id" className="h-7 w-56 rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <a href={exportHref(tab, "csv")} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />CSV</a>
            <a href={exportHref(tab, "xlsx")} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />Excel</a>
          </div>
        }
      >
        <div className="flex gap-1 mb-2">
          {([["active", "Active"], ["pastDue", "Past due (revivable)"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("text-xs px-2.5 py-1 rounded-md", tab === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>{label}</button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground self-center">{filtered.length} shown (top {rows.length})</span>
        </div>
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50 sticky top-0 bg-background">
              <th className="py-1.5 font-medium">Customer</th><th className="font-medium">Gateway</th><th className="font-medium">Plan</th><th className="font-medium text-right">Amount</th><th className="font-medium">Status</th><th className="font-medium">Started</th><th className="font-medium">Last charge</th>
            </tr></thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-border/30 hover:bg-muted/40">
                  <td className="py-1.5">
                    <div className="font-medium">{s(r.customer_name) || <span className="text-muted-foreground">—</span>}</div>
                    <div className="text-muted-foreground">{s(r.customer_email) || s(r.customer_phone)}</div>
                  </td>
                  <td className="text-muted-foreground">{gwLabel(s(r.gateway))}</td>
                  <td className="max-w-[200px] truncate" title={s(r.plan_name)}>{s(r.plan_name) || <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-right tabular-nums">{money(r.plan_amount, r.currency)}<span className="text-muted-foreground">{r.billing_interval ? `/${s(r.billing_interval)[0]}` : ""}</span></td>
                  <td><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_STYLE[s(r.status)] ?? STATUS_STYLE.expired)}>{s(r.status)}</span></td>
                  <td className="text-muted-foreground">{r.started_at ? formatDate(s(r.started_at)) : "—"}</td>
                  <td className="text-muted-foreground">{r.last_charge_at ? formatDate(s(r.last_charge_at)) : "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No subscriptions</td></tr>}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
