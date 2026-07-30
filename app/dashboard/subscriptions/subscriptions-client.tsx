"use client";

import { useMemo, useState } from "react";
import { Download, Search, Repeat, TrendingUp, AlertTriangle, XCircle, Clock, UserPlus } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { SubscriptionsOverview } from "@/lib/subscriptions/reports";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

const GATEWAY_LABEL: Record<string, string> = {
  cashfree: "Cashfree", stripe: "Stripe", razorpay: "Razorpay", app_store: "App Store",
  payu: "PayU", paytm: "Paytm", easebuzz: "Easebuzz",
};

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-600",
  past_due: "bg-amber-500/15 text-amber-600",
  cancelled: "bg-rose-500/15 text-rose-600",
  expired: "bg-neutral-500/15 text-neutral-500",
  unknown: "bg-neutral-500/10 text-neutral-500",
};

function money(amount: unknown, currency: unknown) {
  const a = Number(amount);
  if (!Number.isFinite(a) || a === 0) return "—";
  return formatCurrency(a, (currency as string) || "INR");
}

/** Build a CSV from rows + a column spec and trigger a download. Includes customer PII. */
function downloadCsv(filename: string, cols: Array<{ key: string; label: string }>, rows: Row[]) {
  const esc = (v: unknown) => {
    const str = v == null ? "" : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [cols.map((c) => c.label).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

const LIST_COLS: Array<{ key: string; label: string }> = [
  { key: "customer_name", label: "Customer" },
  { key: "customer_email", label: "Email" },
  { key: "customer_phone", label: "Phone" },
  { key: "gateway", label: "Gateway" },
  { key: "plan_name", label: "Plan" },
  { key: "plan_amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "billing_interval", label: "Interval" },
  { key: "status", label: "Status" },
  { key: "subscription_id", label: "Subscription ID" },
  { key: "started_at", label: "Started" },
  { key: "current_period_end", label: "Period end" },
  { key: "next_charge_at", label: "Next charge" },
];

export function SubscriptionsClient({ data }: { data: SubscriptionsOverview }) {
  const { totals, byGateway, period, byPlan } = data;
  const [tab, setTab] = useState<"active" | "upcoming" | "pastDue">("active");
  const [q, setQ] = useState("");

  const rows = tab === "active" ? data.activeList : tab === "upcoming" ? data.upcomingList : data.pastDueList;
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) =>
      [r.customer_name, r.customer_email, r.customer_phone, r.plan_name, r.subscription_id, r.gateway]
        .some((v) => s(v).toLowerCase().includes(t))
    );
  }, [rows, q]);

  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter">
        <MetricCard title="Active subscriptions" value={totals.activeSubs.toLocaleString("en-IN")} icon={<Repeat className="size-4" />} subtitle={`${byGateway.length} gateways`} />
        <MetricCard title="MRR" value={formatCurrency(totals.mrr, "INR", true)} icon={<TrendingUp className="size-4" />} subtitle="Monthly recurring (run-rate)" accentColor="#10b981" />
        <MetricCard title="ARR" value={formatCurrency(totals.arr, "INR", true)} subtitle="MRR × 12" />
        <MetricCard title="Past due (dunning)" value={totals.pastDue.toLocaleString("en-IN")} icon={<AlertTriangle className="size-4" />} severity={totals.pastDue > 0 ? "warning" : undefined} subtitle="Failed renewals at risk" />
      </div>

      {/* Period + funnel */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter-1">
        <MetricCard title="New this month" value={period.newThisMonth.toLocaleString("en-IN")} icon={<UserPlus className="size-4" />} />
        <MetricCard title="Renewals this month" value={period.renewalsThisMonth.toLocaleString("en-IN")} icon={<Repeat className="size-4" />} />
        <MetricCard title="Cancelled this month" value={period.cancelledThisMonth.toLocaleString("en-IN")} icon={<XCircle className="size-4" />} />
        <MetricCard title="Renewals due (30d)" value={period.upcoming30d.toLocaleString("en-IN")} icon={<Clock className="size-4" />} />
      </div>

      {/* Pending funnel note */}
      {totals.pending > 0 && (
        <p className="text-xs text-muted-foreground px-1">
          {totals.pending.toLocaleString("en-IN")} subscriptions are <strong>pending / not activated</strong> (mandate created but authorization never completed) — shown separately from active, and a useful signup-funnel signal.
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-3 animate-enter-1">
        {/* By gateway */}
        <SectionCard title="By gateway" subtitle="Active subscriptions & MRR">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50">
              <th className="py-1.5 font-medium">Gateway</th><th className="font-medium text-right">Active</th><th className="font-medium text-right">MRR</th><th className="font-medium text-right">Pending</th><th className="font-medium text-right">Cancelled</th>
            </tr></thead>
            <tbody>
              {byGateway.sort((a, b) => b.mrr - a.mrr).map((g) => (
                <tr key={g.gateway} className="border-b border-border/30">
                  <td className="py-1.5">{GATEWAY_LABEL[g.gateway] ?? g.gateway}</td>
                  <td className="text-right tabular-nums">{g.active.toLocaleString("en-IN")}</td>
                  <td className="text-right tabular-nums">{formatCurrency(g.mrr, "INR", true)}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{g.pending.toLocaleString("en-IN")}</td>
                  <td className="text-right tabular-nums text-muted-foreground">{g.cancelled.toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        {/* Revenue by plan */}
        <SectionCard title="Revenue by plan" subtitle="Active MRR by plan (top 50)"
          action={<button onClick={() => downloadCsv(`subscriptions_by_plan_${new Date().toISOString().slice(0, 10)}.csv`, [{ key: "gateway", label: "Gateway" }, { key: "plan", label: "Plan" }, { key: "active", label: "Active" }, { key: "mrr", label: "MRR (INR)" }], byPlan)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><Download className="size-3.5" />CSV</button>}>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border/50 sticky top-0 bg-background">
                <th className="py-1.5 font-medium">Plan</th><th className="font-medium">Gateway</th><th className="font-medium text-right">Active</th><th className="font-medium text-right">MRR</th>
              </tr></thead>
              <tbody>
                {byPlan.map((p, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1.5 max-w-[220px] truncate" title={p.plan}>{p.plan}</td>
                    <td className="text-muted-foreground">{GATEWAY_LABEL[p.gateway] ?? p.gateway}</td>
                    <td className="text-right tabular-nums">{p.active.toLocaleString("en-IN")}</td>
                    <td className="text-right tabular-nums">{formatCurrency(p.mrr, "INR", true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* Subscription lists */}
      <SectionCard
        title="Subscriptions"
        subtitle="Customer-level detail"
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer / plan / id" className="h-7 w-56 rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <a href={`/api/subscriptions/export?report=${tab}&format=csv`} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />CSV</a>
            <a href={`/api/subscriptions/export?report=${tab}&format=xlsx`} className="inline-flex items-center gap-1 text-xs h-7 px-2 rounded-md border border-border hover:bg-muted"><Download className="size-3.5" />Excel</a>
          </div>
        }
      >
        <div className="flex gap-1 mb-2">
          {([["active", "Active"], ["upcoming", "Renewals due (30d)"], ["pastDue", "Past due"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={cn("text-xs px-2.5 py-1 rounded-md", tab === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>{label}</button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground self-center">{filtered.length} shown (top {rows.length})</span>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50 sticky top-0 bg-background">
              <th className="py-1.5 font-medium">Customer</th><th className="font-medium">Gateway</th><th className="font-medium">Plan</th><th className="font-medium text-right">Amount</th><th className="font-medium">Status</th><th className="font-medium">Started</th><th className="font-medium">{tab === "upcoming" ? "Next charge" : "Period end"}</th>
            </tr></thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-border/30 hover:bg-muted/40">
                  <td className="py-1.5">
                    <div className="font-medium">{s(r.customer_name) || <span className="text-muted-foreground">—</span>}</div>
                    <div className="text-muted-foreground">{s(r.customer_email) || s(r.customer_phone)}</div>
                  </td>
                  <td className="text-muted-foreground">{GATEWAY_LABEL[s(r.gateway)] ?? s(r.gateway)}</td>
                  <td className="max-w-[200px] truncate" title={s(r.plan_name)}>{s(r.plan_name) || <span className="text-muted-foreground">—</span>}</td>
                  <td className="text-right tabular-nums">{money(r.plan_amount, r.currency)}<span className="text-muted-foreground">{r.billing_interval ? `/${s(r.billing_interval)[0]}` : ""}</span></td>
                  <td><span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_STYLE[s(r.status)] ?? STATUS_STYLE.unknown)}>{s(r.status)}</span></td>
                  <td className="text-muted-foreground">{r.started_at ? formatDate(s(r.started_at)) : "—"}</td>
                  <td className="text-muted-foreground">{(tab === "upcoming" ? r.next_charge_at : r.current_period_end) ? formatDate(s(tab === "upcoming" ? r.next_charge_at : r.current_period_end)) : "—"}</td>
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
