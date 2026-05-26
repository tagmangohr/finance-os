export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import { Send } from "lucide-react";
import { getOrgId, getCollectionsData } from "@/lib/data";
import { MetricCard } from "@/components/dashboard/metric-card";
import { formatCurrency, formatDate } from "@/lib/utils";

function Panel({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-white/[0.06] overflow-hidden transition-all duration-200 hover:border-white/[0.09]"
      style={{ background: "hsl(220 40% 7%)" }}
    >
      <div className="px-4 pt-3.5 pb-0">
        <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/40">{title}</p>
        {subtitle && <p className="text-[10.5px] text-white/20 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-4 pb-4 pt-2">{children}</div>
    </div>
  );
}

export default async function CollectionsPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const { overdueInvoices, debtors, aging, totalOutstanding, collectionRate } =
    await getCollectionsData(orgId);

  const agingBuckets = [
    { label: "0–30 days",  amount: aging.overdue030,    color: "#f59116", bg: "rgba(245,145,22,0.12)",  textColor: "#f59116" },
    { label: "31–60 days", amount: aging.overdue3160,   color: "#f97316", bg: "rgba(249,115,22,0.12)",  textColor: "#f97316" },
    { label: "61–90 days", amount: aging.overdue6190,   color: "#e83a3a", bg: "rgba(232,58,58,0.12)",   textColor: "#e83a3a" },
    { label: "90+ days",   amount: aging.overdue90plus, color: "#b91c1c", bg: "rgba(185,28,28,0.12)",   textColor: "#ef4444" },
  ];
  const maxAmount = Math.max(...agingBuckets.map((b) => b.amount), 1);

  return (
    <div className="space-y-3 max-w-[1400px]">

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="animate-enter">
        <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-white/25 mb-0.5">Finance OS</p>
        <h1 className="text-[22px] font-bold tracking-tight text-white/90 leading-none">Collections</h1>
      </div>

      {/* ── 4 metric cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter-delay-1">
        <MetricCard
          title="Total Outstanding"
          value={formatCurrency(totalOutstanding, "INR", true)}
          subtitle="All receivables"
          severity={totalOutstanding > 0 ? "warning" : "good"}
        />
        <MetricCard
          title="0–30 Days"
          value={formatCurrency(aging.overdue030, "INR", true)}
          subtitle="Recently overdue"
          severity={aging.overdue030 > 0 ? "warning" : "good"}
        />
        <MetricCard
          title="31–60 Days"
          value={formatCurrency(aging.overdue3160, "INR", true)}
          subtitle="Needs follow-up"
          severity={aging.overdue3160 > 0 ? "warning" : "good"}
        />
        <MetricCard
          title="90+ Days"
          value={formatCurrency(aging.overdue90plus, "INR", true)}
          subtitle="Serious default risk"
          severity={aging.overdue90plus > 0 ? "critical" : "good"}
        />
      </div>

      {/* ── Debtor table + Aging buckets ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-delay-2">

        {/* Debtor table */}
        <div
          className="lg:col-span-2 rounded-xl border border-white/[0.06] overflow-hidden transition-all duration-200 hover:border-white/[0.09]"
          style={{ background: "hsl(220 40% 7%)" }}
        >
          <div className="px-4 pt-3.5 pb-0">
            <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/40">Outstanding Debtors</p>
          </div>
          <div className="px-4 pb-4 pt-2">
            {debtors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2">
                <div className="h-9 w-9 rounded-full bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center">
                  <span className="text-emerald-400">✓</span>
                </div>
                <p className="text-[12px] text-white/25">No outstanding receivables</p>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr>
                      <th className="text-left pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Entity</th>
                      <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Outstanding</th>
                      <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25 hidden md:table-cell">Avg Days</th>
                      <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25 hidden md:table-cell">Last Invoice</th>
                      <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtors.map((debtor) => {
                      const avgDays = debtor.avg_payment_days ?? 0;
                      const isCritical = avgDays > 90;
                      const isWarning = avgDays > 30 && !isCritical;
                      return (
                        <tr key={debtor.id} className="border-t border-white/[0.04] group">
                          <td className="py-2.5">
                            <p className="font-medium text-white/60 group-hover:text-white/80 transition-colors">{debtor.name}</p>
                            {debtor.email && <p className="text-[10.5px] text-white/25 mt-0.5">{debtor.email}</p>}
                          </td>
                          <td className="py-2.5 text-right num font-bold text-white/70">
                            {formatCurrency(debtor.outstanding_amount, "INR", true)}
                          </td>
                          <td className="py-2.5 text-right hidden md:table-cell">
                            {avgDays > 0 ? (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold num"
                                style={isCritical
                                  ? { background: "rgba(232,58,58,0.12)", color: "#e83a3a" }
                                  : isWarning
                                  ? { background: "rgba(245,145,22,0.12)", color: "#f59116" }
                                  : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }
                                }
                              >
                                {Math.round(avgDays)}d
                              </span>
                            ) : (
                              <span className="text-white/20">—</span>
                            )}
                          </td>
                          <td className="py-2.5 text-right text-white/30 hidden md:table-cell">
                            {debtor.last_transaction_date ? formatDate(debtor.last_transaction_date) : "—"}
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Link
                                href={`/dashboard/intelligence?ask=Send reminder to ${encodeURIComponent(debtor.name)}`}
                                className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10.5px] font-medium border border-primary/20 bg-primary/[0.07] text-primary/60 hover:text-primary hover:bg-primary/[0.12] transition-all"
                              >
                                <Send className="h-2.5 w-2.5" />
                                Remind
                              </Link>
                              {isCritical && (
                                <Link
                                  href={`/dashboard/intelligence?ask=Escalation steps for ${encodeURIComponent(debtor.name)}`}
                                  className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10.5px] font-medium border border-red-400/20 bg-red-400/[0.07] text-red-400/60 hover:text-red-400 hover:bg-red-400/[0.12] transition-all"
                                >
                                  Escalate
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Aging breakdown */}
        <Panel title="Overdue Aging">
          <div className="space-y-3 mt-1">
            {agingBuckets.map((bucket) => (
              <div key={bucket.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-white/45">{bucket.label}</span>
                  <span className="num text-[12px] font-semibold" style={{ color: bucket.textColor }}>
                    {formatCurrency(bucket.amount, "INR", true)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${(bucket.amount / maxAmount) * 100}%`,
                      background: bucket.color,
                      opacity: 0.75,
                    }}
                  />
                </div>
              </div>
            ))}

            {totalOutstanding > 0 && (
              <div className="pt-3 border-t border-white/[0.05]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-white/35">Collection rate</span>
                  <span className="num text-[13px] font-bold text-white/65">{collectionRate.toFixed(1)}%</span>
                </div>
              </div>
            )}
          </div>
        </Panel>

      </div>

      {/* ── Overdue invoices table ────────────────────────────────────── */}
      <Panel title="Overdue Invoices">
        {overdueInvoices.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-[13px] text-white/25">
            No overdue invoices
          </div>
        ) : (
          <div className="overflow-x-auto mt-1">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  <th className="text-left pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Invoice #</th>
                  <th className="text-left pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Customer</th>
                  <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Amount</th>
                  <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25 hidden sm:table-cell">Due Date</th>
                  <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Overdue</th>
                  <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Action</th>
                </tr>
              </thead>
              <tbody>
                {overdueInvoices.map((invoice) => {
                  const isCritical = invoice.days_overdue > 90;
                  const isWarning = invoice.days_overdue > 30 && !isCritical;
                  return (
                    <tr key={invoice.invoice_id} className="border-t border-white/[0.04] group">
                      <td className="py-2 t-mono text-[11px] text-white/30">{invoice.invoice_number}</td>
                      <td className="py-2 font-medium text-white/60 group-hover:text-white/80 transition-colors">{invoice.entity_name}</td>
                      <td className="py-2 text-right num font-semibold text-white/70">
                        {formatCurrency(invoice.amount, "INR", true)}
                      </td>
                      <td className="py-2 text-right text-white/30 hidden sm:table-cell">
                        {formatDate(invoice.due_date)}
                      </td>
                      <td className="py-2 text-right">
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold num"
                          style={isCritical
                            ? { background: "rgba(232,58,58,0.12)", color: "#e83a3a" }
                            : isWarning
                            ? { background: "rgba(245,145,22,0.12)", color: "#f59116" }
                            : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }
                          }
                        >
                          {invoice.days_overdue}d
                        </span>
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/dashboard/intelligence?ask=Draft reminder for ${encodeURIComponent(invoice.entity_name)}`}
                          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10.5px] font-medium border border-white/[0.07] bg-white/[0.02] text-white/35 hover:text-white/70 hover:bg-white/[0.05] transition-all"
                        >
                          <Send className="h-2.5 w-2.5" />
                          Send
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
