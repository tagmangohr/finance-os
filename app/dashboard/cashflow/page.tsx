export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { getOrgId, getCashFlowDetails } from "@/lib/data";
import { CashFlowChart } from "@/components/charts/cashflow-chart";
import { CategoryChart } from "@/components/charts/category-chart";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Button } from "@/components/ui/button";
import { formatCurrency, runwaySeverity } from "@/lib/utils";
import { format } from "date-fns";

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

export default async function CashFlowPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const { cashFlowData, monthlyData, forecasts, burnRate, categoryBreakdown } =
    await getCashFlowDetails(orgId);

  return (
    <div className="space-y-3 max-w-[1400px]">

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="animate-enter">
        <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-white/25 mb-0.5">Finance OS</p>
        <h1 className="text-[22px] font-bold tracking-tight text-white/90 leading-none">Cash Flow</h1>
      </div>

      {/* ── Full-width chart ──────────────────────────────────────────── */}
      <Panel title="Cash Flow" subtitle="last 30 days">
        {cashFlowData.length > 0 ? (
          <>
            <CashFlowChart data={cashFlowData} height={300} />
            {/* Legend */}
            <div className="flex items-center gap-4 mt-1 px-1">
              {[
                { color: "#1db884", label: "Inflow" },
                { color: "#e83a3a", label: "Outflow" },
                { color: "#7c52f0", label: "Balance", dashed: true },
              ].map(({ color, label, dashed }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className="flex items-center gap-0.5 w-5">
                    {dashed ? (
                      <>
                        <div className="h-px w-2 rounded" style={{ background: color }} />
                        <div className="h-px w-1 rounded" style={{ background: color, opacity: 0.4 }} />
                        <div className="h-px w-2 rounded" style={{ background: color }} />
                      </>
                    ) : (
                      <div className="h-2 w-2 rounded-sm opacity-80" style={{ background: color }} />
                    )}
                  </div>
                  <span className="text-[10.5px] text-white/35">{label}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-52 gap-3">
            <ArrowLeftRight className="h-7 w-7 text-white/10" />
            <p className="text-[13px] text-white/25">No transaction data yet</p>
            <Button variant="link" asChild className="text-primary/60 hover:text-primary h-auto p-0">
              <Link href="/dashboard/connectors">Connect a data source →</Link>
            </Button>
          </div>
        )}
      </Panel>

      {/* ── 3 forecast cards ─────────────────────────────────────────── */}
      <div>
        <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-white/20 mb-2 px-0.5">Projected Net Cash Flow</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 animate-enter-delay-1">
          {forecasts.map(({ days, projectedBalance }) => (
            <MetricCard
              key={days}
              title={`${days}-Day Projection`}
              value={formatCurrency(projectedBalance, "INR", true)}
              subtitle="Based on avg monthly net"
              severity={projectedBalance > 0 ? "good" : projectedBalance < 0 ? "critical" : "neutral"}
            />
          ))}
        </div>
      </div>

      {/* ── Monthly P&L table + outflow donut ────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-delay-2">

        {/* Monthly table */}
        <Panel title="Monthly Inflows vs Outflows" subtitle="P&amp;L summary">
          <div className="overflow-x-auto mt-1" style={{ gridColumn: "span 2" }}>
            {monthlyData.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-[13px] text-white/25">
                No monthly data available
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr>
                    <th className="text-left pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Month</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Inflow</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Outflow</th>
                    <th className="text-right pb-2 text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/25">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData.map((row) => {
                    let displayMonth = row.month;
                    try { displayMonth = format(new Date(row.month + "-01"), "MMM yyyy"); } catch { /**/ }
                    const isPositive = row.net >= 0;
                    return (
                      <tr key={row.month} className="border-t border-white/[0.04] group">
                        <td className="py-2 text-white/50 group-hover:text-white/70 transition-colors">{displayMonth}</td>
                        <td className="py-2 text-right num font-semibold" style={{ color: "#1db884" }}>
                          {formatCurrency(row.inflow, "INR", true)}
                        </td>
                        <td className="py-2 text-right num font-semibold" style={{ color: "#e83a3a" }}>
                          {formatCurrency(row.outflow, "INR", true)}
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold num"
                            style={isPositive
                              ? { background: "rgba(29,184,132,0.10)", color: "#1db884" }
                              : { background: "rgba(232,58,58,0.10)", color: "#e83a3a" }
                            }
                          >
                            {isPositive ? "+" : ""}{formatCurrency(row.net, "INR", true)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Panel>

        {/* Expense donut */}
        <Panel title="Expense Categories">
          {categoryBreakdown.length > 0 ? (
            <CategoryChart data={categoryBreakdown} />
          ) : (
            <div className="flex items-center justify-center h-40 text-[13px] text-white/25">
              No expense data yet
            </div>
          )}
        </Panel>

      </div>
    </div>
  );
}
