"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBag, TrendingUp, Hash, Receipt, Search, Plug, Layers } from "lucide-react";
import { useNavProgress } from "@/components/dashboard/nav-progress";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { SalesOverview, SalesTxn } from "@/lib/sales/reports";

const inr = (n: number, compact = false) => formatCurrency(n, "INR", compact);
const PAGE = 50;
const MONTH_LABEL = (m: string) => {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
};

export function SalesClient({ data, hasSales, sources }: { data: SalesOverview; hasSales: boolean; sources: string[] }) {
  const { navigate } = useNavProgress();

  // Overview (cards/trend/breakdown) — seeded from the server, re-fetched when the
  // breakdown dimension changes (date range changes via a full navigation instead).
  const [overview, setOverview] = useState<SalesOverview>(data);
  const [dimension, setDimension] = useState<string | null>(data.dimension);
  const [loadingDim, setLoadingDim] = useState(false);
  useEffect(() => { setOverview(data); setDimension(data.dimension); }, [data]);

  const changeDimension = async (dim: string) => {
    setDimension(dim);
    setLoadingDim(true);
    try {
      const params = new URLSearchParams({ from: data.period.from, to: data.period.to, dimension: dim });
      const res = await fetch(`/api/sales/overview?${params.toString()}`);
      const j = await res.json();
      if (res.ok) setOverview(j as SalesOverview);
    } catch { /* keep last */ } finally { setLoadingDim(false); }
  };

  // ── Transactions table (server-paginated) ──
  const [rows, setRows] = useState<SalesTxn[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(true);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("all");
  const [page, setPage] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setQ(qInput); setPage(0); }, 350); return () => clearTimeout(t); }, [qInput]);

  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const params = new URLSearchParams({
        from: data.period.from, to: data.period.to,
        search: q, source, page: String(page), pageSize: String(PAGE),
      });
      const res = await fetch(`/api/sales/transactions?${params.toString()}`);
      const j = await res.json();
      if (res.ok) { setRows(j.rows ?? []); setTotal(j.total ?? 0); }
    } catch { /* noop */ } finally { setLoadingRows(false); }
  }, [data.period.from, data.period.to, q, source, page]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE));

  // ── Empty state ──
  if (!hasSales) {
    return (
      <div className="max-w-[1400px]">
        <div className="rounded-xl border border-border bg-card p-10 text-center animate-enter">
          <ShoppingBag className="size-8 mx-auto text-muted-foreground/60" />
          <h2 className="mt-3 text-lg font-semibold">Bring your sales into Finance OS</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Connect a Google Sheet, Excel or CSV of your sales — any columns, any number of tabs.
            We detect every column, count the volume as revenue, and let you break it down by product,
            region, channel, or anything else in the sheet.
          </p>
          <Link href="/dashboard/connectors" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plug className="size-4" /> Connect a sales source
          </Link>
          <p className="mt-3 text-[11px] text-muted-foreground/70 max-w-md mx-auto">
            In the connector setup, set the tab&apos;s destination to <span className="font-medium">Sales</span>.
          </p>
        </div>
      </div>
    );
  }

  const maxMonth = Math.max(1, ...overview.byMonth.map((m) => Math.abs(m.amount)));
  const maxDim = Math.max(1, ...overview.byDimension.map((d) => Math.abs(d.amount)));
  const dimTotal = overview.byDimension.reduce((a, d) => a + d.amount, 0);

  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateRangePicker
          from={data.period.from}
          to={data.period.to}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(f, t) => navigate(`/dashboard/sales?from=${f}&to=${t}${dimension ? `&dimension=${encodeURIComponent(dimension)}` : ""}`)}
        />
      </div>
      <p className="text-[11px] text-muted-foreground px-1">
        Sales ledger · {data.period.from} → {data.period.to} · {overview.txnCount.toLocaleString("en-IN")} records · counts as revenue
      </p>

      {/* Smart cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter">
        <MetricCard title="Total sales" value={inr(overview.total, true)} icon={<TrendingUp className="size-4" />} accentColor="#10b981" subtitle="Net sales in range (revenue)" />
        <MetricCard title="Orders" value={overview.orders.toLocaleString("en-IN")} icon={<Hash className="size-4" />} subtitle="Sale records in range" />
        <MetricCard title="Avg order value" value={inr(overview.aov, true)} icon={<Receipt className="size-4" />} subtitle="Total ÷ orders" />
        <MetricCard title="Sources" value={sources.length.toLocaleString("en-IN")} icon={<Layers className="size-4" />} subtitle="Connected sales tabs" />
      </div>

      {/* Trend */}
      <SectionCard title="Sales over time" subtitle="Monthly sales in range" className="animate-enter-1">
        {overview.byMonth.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">No sales in this range.</p>
        ) : (
          <div className="flex items-end gap-2 h-40 pt-4">
            {overview.byMonth.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
                <span className="text-[10px] text-muted-foreground tabular-nums">{inr(m.amount, true)}</span>
                <div
                  className="w-full max-w-[48px] rounded-t bg-primary/70 transition-all"
                  style={{ height: `${Math.max(2, (Math.abs(m.amount) / maxMonth) * 100)}%` }}
                  title={`${MONTH_LABEL(m.month)} · ${inr(m.amount)}`}
                />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{MONTH_LABEL(m.month)}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Breakdown by any detected dimension */}
      <SectionCard
        title="Sales breakdown"
        subtitle={overview.dimension ? `Top values by ${overview.dimension}` : "No columns detected"}
        className="animate-enter-2"
        action={
          overview.dimensions.length > 0 ? (
            <select
              value={dimension ?? ""}
              onChange={(e) => changeDimension(e.target.value)}
              disabled={loadingDim}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none max-w-[220px] disabled:opacity-50"
            >
              {overview.dimensions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          ) : undefined
        }
      >
        {loadingDim ? (
          <div className="py-8 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-8 rounded-lg bg-muted/50 animate-pulse" />)}</div>
        ) : overview.byDimension.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Nothing to break down for this column.</p>
        ) : (
          <div className="space-y-1.5">
            {overview.byDimension.map((d) => (
              <div key={d.value} className="relative flex items-center gap-3 rounded-lg px-2.5 py-1.5">
                <div className="absolute inset-y-0 left-0 rounded-lg bg-primary/[0.07]" style={{ width: `${(Math.abs(d.amount) / maxDim) * 100}%` }} />
                <span className="relative z-[1] flex-1 min-w-0 truncate text-xs text-foreground">{d.value}</span>
                <span className="relative z-[1] text-xs tabular-nums font-medium">{inr(d.amount)}</span>
                <span className="relative z-[1] w-12 text-right text-[10px] tabular-nums text-muted-foreground">{dimTotal ? Math.round((d.amount / dimTotal) * 100) : 0}%</span>
                <span className="relative z-[1] w-14 text-right text-[10px] tabular-nums text-muted-foreground">{d.count.toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Transactions */}
      <SectionCard
        title="Sales records"
        subtitle={`${total.toLocaleString("en-IN")} match`}
        className="animate-enter-3"
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1">
              <Search className="size-3.5 text-muted-foreground" />
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search…" className="bg-transparent text-xs outline-none w-40" />
            </div>
            {sources.length > 1 && (
              <select value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }} className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none">
                <option value="all">All sources</option>
                {sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50">
              <th className="py-1.5 font-medium">Date</th>
              <th className="font-medium">Source</th>
              <th className="font-medium">Details</th>
              {dimension && <th className="font-medium">{dimension}</th>}
              <th className="font-medium text-right">Amount</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={dimension ? 5 : 4} className="py-8 text-center text-muted-foreground">{loadingRows ? "Loading…" : "No sales match."}</td></tr>
              ) : rows.map((t) => (
                <tr key={t.id} className="border-b border-border/30">
                  <td className="py-1.5 whitespace-nowrap text-muted-foreground">{formatDate(t.transaction_date)}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{t.account_type ?? "—"}</td>
                  <td className="max-w-[320px] truncate">{t.counterparty_name || t.description || "—"}</td>
                  {dimension && <td className="max-w-[200px] truncate text-muted-foreground">{String(t.raw?.[dimension] ?? "—")}</td>}
                  <td className="text-right tabular-nums whitespace-nowrap text-emerald-600">+{inr(Number(t.amount_base ?? t.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > PAGE && (
          <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
            <span>Page {page + 1} of {pageCount}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:border-border/60">Prev</button>
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="rounded-md border border-border px-2 py-1 disabled:opacity-40 hover:border-border/60">Next</button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
