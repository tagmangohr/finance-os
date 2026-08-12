"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { Download, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { SectionCard } from "@/components/dashboard/section-card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { SubscriptionMetricStrip } from "@/components/dashboard/subscription-metric-strip";
import { computeSubscriptionMetrics } from "@/lib/subscriptions/metric-registry";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { SubscriptionsOverview } from "@/lib/subscriptions/reports";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const nfmt = (n: number) => n.toLocaleString("en-IN");
const inr = (n: number) => formatCurrency(n, "INR", true);
const pctv = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

const GATEWAY_LABEL: Record<string, string> = { cashfree: "Cashfree", stripe: "Stripe", razorpay: "Razorpay", app_store: "Apple Pay", payu: "PayU", paytm: "Paytm", easebuzz: "Easebuzz" };
const gwLabel = (g: string) => GATEWAY_LABEL[g] ?? g;
const GATEWAY_COLOR: Record<string, string> = { stripe: "#2a78d6", cashfree: "#1baf7a", razorpay: "#eb6834", app_store: "#eda100" };
const monthLabel = (m: string) => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

function money(amount: unknown, currency: unknown) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a === 0) return "—";
  return formatCurrency(a, (currency as string) || "INR");
}

const SEG_STYLE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600",
  past_due: "bg-amber-500/15 text-amber-600",
  churned: "bg-rose-500/15 text-rose-600",
  pending: "bg-neutral-500/15 text-neutral-500",
};
const SEG_TABS = [["active", "Active"], ["past_due", "Past due (revivable)"], ["churned", "Churned"], ["pending", "Pending"]] as const;

export function SubscriptionsClient({ data, prefs, orgId }: { data: SubscriptionsOverview; prefs: { pinned: string[]; visibleCount: number }; orgId: string }) {
  const { kpis, byGateway, monthly, cohorts, cohortPeriods, contractMix, grace } = data;
  const [chartView, setChartView] = useState<"total" | "gateway">("total");
  const computed = useMemo(() => computeSubscriptionMetrics(data), [data]);

  const monthlyChart = monthly.map((m) => ({ month: monthLabel(m.month), MRR: m.mrr, New: m.newSubs, Churned: -m.churnedSubs }));
  const gatewayList = useMemo(() => {
    const set = new Set<string>();
    for (const r of data.monthlyByGateway) if (r.mrr > 0) set.add(r.gateway);
    return ["stripe", "cashfree", "razorpay", "app_store"].filter((g) => set.has(g)).concat([...set].filter((g) => !GATEWAY_COLOR[g]));
  }, [data.monthlyByGateway]);
  const gatewayChart = useMemo(() => {
    const byMonth = new Map<string, Record<string, number | string>>();
    for (const r of data.monthlyByGateway) {
      const k = monthLabel(r.month);
      const row = byMonth.get(k) ?? { month: k };
      row[r.gateway] = (Number(row[r.gateway]) || 0) + r.mrr;
      byMonth.set(k, row);
    }
    return [...byMonth.values()];
  }, [data.monthlyByGateway]);

  const contract = useMemo(() => {
    const mo = contractMix.find((m) => m.interval === "month");
    const yr = contractMix.find((m) => m.interval === "year");
    return { moMrr: mo?.mrr ?? 0, yrMrr: yr?.mrr ?? 0 };
  }, [contractMix]);

  return (
    <div className="space-y-3 max-w-[1400px]">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Subscriptions</h1>
          <p className="text-xs text-muted-foreground">Recurring revenue across all gateways · MRR/ARR are current run-rate; new/churned are month-wise · churned once &gt;1 month past due</p>
        </div>
      </div>

      {/* Customizable KPI strip — pin/reorder/count via the Customize drawer */}
      <SubscriptionMetricStrip computed={computed} initialPinned={prefs.pinned} initialVisibleCount={prefs.visibleCount} orgId={orgId} />

      {/* Growth over time */}
      <SectionCard title="Growth over time" subtitle={chartView === "total" ? "Active MRR and net subscriber movement, by month" : "MRR by gateway, stacked, by month"}
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["total", "gateway"] as const).map((v) => (
                <button key={v} onClick={() => setChartView(v)} className={cn("text-xs px-2.5 py-1", chartView === v ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>{v === "total" ? "Total" : "By gateway"}</button>
              ))}
            </div>
            <a href={`/api/subscriptions/export?report=monthly&format=csv&grace=${grace}`} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />Month-wise</a>
            <a href={`/api/subscriptions/export?report=gateway&format=csv&grace=${grace}`} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />By gateway</a>
          </div>
        }>
        {chartView === "total" ? (
          <div className="space-y-2">
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyChart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => inr(Number(v))} width={64} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} formatter={(v: number) => inr(v)} />
                  <Line type="monotone" dataKey="MRR" stroke="#2a78d6" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-4 text-[11px] text-muted-foreground px-1">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ background: "#0ca30c" }} />New subscribers</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded" style={{ background: "#d03b3b" }} />Churned subscribers</span>
            </div>
            <div className="h-[140px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyChart} stackOffset="sign" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${Math.abs(Number(v) / 1000)}k`} width={40} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} formatter={(v: number, n) => [nfmt(Math.abs(v)), n]} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="New" stackId="m" fill="#0ca30c" radius={[2, 2, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="Churned" stackId="m" fill="#d03b3b" radius={[0, 0, 2, 2]} maxBarSize={22} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex gap-4 text-[11px] text-muted-foreground px-1 mb-1 flex-wrap">
              {gatewayList.map((g) => <span key={g} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: GATEWAY_COLOR[g] ?? "#888" }} />{gwLabel(g)}</span>)}
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={gatewayChart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => inr(Number(v))} width={64} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }} formatter={(v: number, n) => [inr(v), gwLabel(String(n))]} />
                  {gatewayList.map((g) => <Area key={g} type="monotone" dataKey={g} stackId="g" stroke={GATEWAY_COLOR[g] ?? "#888"} fill={GATEWAY_COLOR[g] ?? "#888"} fillOpacity={0.85} strokeWidth={1} />)}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
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
        <SectionCard title="By gateway" subtitle="Active & recoverable are current; churned is all-time">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50">
              <th className="py-1.5 font-medium">Gateway</th><th className="font-medium text-right">Active (now)</th><th className="font-medium text-right">MRR (now)</th>
              <th className="font-medium text-right">Past-due (now)</th><th className="font-medium text-right">Recoverable</th><th className="font-medium text-right">Churned (all-time)</th>
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

        {/* Contract mix */}
        <SectionCard title="Contract mix" subtitle="Active MRR by billing cadence">
          <div className="space-y-3 pt-1">
            {[{ k: "Annual", mrr: contract.yrMrr, c: "#6366f1" }, { k: "Monthly", mrr: contract.moMrr, c: "#10b981" }].map((row) => {
              const total = contract.yrMrr + contract.moMrr || 1;
              const p = (row.mrr / total) * 100;
              return (
                <div key={row.k}>
                  <div className="flex justify-between text-xs mb-1"><span>{row.k}</span><span className="tabular-nums text-muted-foreground">{inr(row.mrr)} · {p.toFixed(0)}%</span></div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full" style={{ width: `${p}%`, background: row.c }} /></div>
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground pt-1">Annual plans are {pctv(kpis.annualSharePct)} of active MRR — higher share = more committed, prepaid revenue.</p>
          </div>
        </SectionCard>
      </div>

      {/* Cohort retention */}
      <SectionCard title="Cohort retention" subtitle="% of each start-month cohort still active after N months · darker = higher">
        <div className="overflow-x-auto">
          <table className="text-xs" style={{ borderCollapse: "separate", borderSpacing: "2px" }}>
            <thead><tr className="text-muted-foreground">
              <th className="text-left font-medium px-2 py-1">Cohort</th>
              <th className="text-right font-medium px-2 py-1">Size</th>
              {Array.from({ length: cohortPeriods + 1 }, (_, k) => <th key={k} className="text-center font-medium px-1 py-1 min-w-[32px]">M{k}</th>)}
            </tr></thead>
            <tbody>
              {[...cohorts].reverse().map((c) => (
                <tr key={c.cohort}>
                  <td className="px-2 py-1 whitespace-nowrap">{monthLabel(c.cohort)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{nfmt(c.size)}</td>
                  {c.pct.map((p, k) => (
                    <td key={k} className="px-1 py-1 text-center tabular-nums rounded"
                      style={p == null ? undefined : { background: `color-mix(in srgb, #2a78d6 ${Math.round(p * 0.85)}%, transparent)`, color: p > 50 ? "white" : "inherit" }}>
                      {p == null ? "" : Math.round(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <CustomersSection grace={grace} />
    </div>
  );
}

// ── Server-paginated customers, one tab per derived segment ─────────────────
function CustomersSection({ grace }: { grace: number }) {
  const [segment, setSegment] = useState<string>("active");
  const [sort, setSort] = useState<string>("mrr");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 50;
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(() => { setDebounced(search); setPage(1); }, 350);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ segment, grace: String(grace), sort, page: String(page), pageSize: String(pageSize), search: debounced });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    try {
      const res = await fetch(`/api/subscriptions/list?${qs}`);
      const j = await res.json();
      setRows(j.rows ?? []); setTotal(j.total ?? 0);
    } catch { setRows([]); setTotal(0); }
    setLoading(false);
  }, [segment, grace, sort, page, debounced, from, to]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const exportHref = (fmt: string) => {
    const q = new URLSearchParams({ report: segment, format: fmt, grace: String(grace) });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return `/api/subscriptions/export?${q}`;
  };

  return (
    <SectionCard title="Customers" subtitle="Every subscription, page-by-page, by status · date filters by start date · with full export"
      action={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer / plan / id" className="h-7 w-56 rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring" />
          </div>
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none">
            <option value="mrr">Sort: MRR</option>
            <option value="lapsed">Sort: oldest lapse</option>
            <option value="recent">Sort: newest</option>
          </select>
          <DateRangePicker from={from} to={to} max={new Date().toISOString().slice(0, 10)} align="end" onChange={(f, t) => { setFrom(f); setTo(t); setPage(1); }} />
          <a href={exportHref("csv")} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />CSV</a>
          <a href={exportHref("xlsx")} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />Excel</a>
        </div>
      }>
      <div className="flex gap-1 mb-2 flex-wrap">
        {SEG_TABS.map(([k, label]) => (
          <button key={k} onClick={() => { setSegment(k); setPage(1); }} className={cn("text-xs px-2.5 py-1 rounded-md", segment === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>{label}</button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground self-center">{loading ? "loading…" : `${nfmt(total)} total`}</span>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground border-b border-border/50 sticky top-0 bg-background">
            <th className="py-1.5 font-medium">Customer</th><th className="font-medium">Gateway</th><th className="font-medium">Plan</th><th className="font-medium text-right">Amount</th><th className="font-medium">Started</th><th className="font-medium">Last charge</th><th className="font-medium">Period end</th>
          </tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/30 hover:bg-muted/40">
                <td className="py-1.5">
                  <div className="font-medium">{s(r.customer_name) || <span className="text-muted-foreground">—</span>}</div>
                  <div className="text-muted-foreground">{s(r.customer_email) || s(r.customer_phone)}</div>
                </td>
                <td className="text-muted-foreground">{gwLabel(s(r.gateway))}</td>
                <td className="max-w-[200px] truncate" title={s(r.plan_name)}>{s(r.plan_name) || <span className="text-muted-foreground">—</span>}</td>
                <td className="text-right tabular-nums">{money(r.plan_amount, r.currency)}<span className="text-muted-foreground">{r.billing_interval ? `/${s(r.billing_interval)[0]}` : ""}</span></td>
                <td className="text-muted-foreground">{r.started_at ? formatDate(s(r.started_at)) : "—"}</td>
                <td className="text-muted-foreground">{r.last_charge_at ? formatDate(s(r.last_charge_at)) : "—"}</td>
                <td className="text-muted-foreground">{r.period_end ? formatDate(s(r.period_end)) : "—"}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No subscriptions</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
        <span>Page {page} of {nfmt(pages)}</span>
        <div className="flex gap-1">
          <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="inline-flex items-center gap-0.5 h-7 px-2 rounded-md border border-border hover:bg-muted disabled:opacity-40"><ChevronLeft className="size-3.5" />Prev</button>
          <button disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="inline-flex items-center gap-0.5 h-7 px-2 rounded-md border border-border hover:bg-muted disabled:opacity-40">Next<ChevronRight className="size-3.5" /></button>
        </div>
      </div>
    </SectionCard>
  );
}
