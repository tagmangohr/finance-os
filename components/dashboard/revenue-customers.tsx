"use client";

import * as React from "react";
import { SectionCard } from "@/components/dashboard/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";

type Customer = { name: string; total_revenue: number; txns: number };

interface Props {
  orgId: string;
  from: string;
  to: string;
  /** Server-computed total revenue for the same window → drives Avg/customer. */
  totalRevenue: number;
  preview?: boolean;
  sampleTop?: Customer[];
  samplePaying?: number;
}

const compactCount = (n: number) =>
  n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n.toLocaleString("en-IN");

// Top Customers + paying-customer stats. Loaded ASYNC (client-side) because the
// live aggregation over transactions can take ~15s for wide ranges — this keeps
// the rest of the Revenue page rendering instantly, with a loading state here.
export function RevenueCustomers({ orgId, from, to, totalRevenue, preview = false, sampleTop = [], samplePaying = 0 }: Props) {
  const [customers, setCustomers] = React.useState<Customer[] | null>(preview ? sampleTop : null);
  const [paying, setPaying] = React.useState<number | null>(preview ? samplePaying : null);
  const [loading, setLoading] = React.useState(!preview);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (preview) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ org_id: orgId, from, to });
    fetch(`/api/revenue/customers?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d: { topCustomers: Customer[]; payingCustomers: number }) => {
        setCustomers(d.topCustomers ?? []);
        setPaying(d.payingCustomers ?? 0);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return; // superseded
        setError(true);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [orgId, from, to, preview]);

  const maxRev = Math.max(...(customers ?? []).map((c) => c.total_revenue), 1);
  const avg = paying && paying > 0 ? totalRevenue / paying : 0;

  return (
    <SectionCard title="Top Customers" subtitle="by revenue in range">
      {/* Paying-customers + avg stat strip */}
      <div className="grid grid-cols-2 gap-2 mb-3 -mt-0.5">
        {[
          { label: "Paying customers", val: paying != null ? (paying > 0 ? compactCount(paying) : "—") : null },
          { label: "Avg / customer", val: paying != null ? (avg > 0 ? formatCurrency(avg, "INR", true) : "—") : null },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border bg-accent/30 px-2.5 py-2">
            <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70 mb-1">{s.label}</p>
            {s.val === null ? <Skeleton className="h-4 w-14" /> : <p className="num text-[15px] font-bold text-foreground leading-none">{s.val}</p>}
          </div>
        ))}
      </div>

      {/* Top 5 list */}
      {error ? (
        <div className="flex items-center justify-center h-[160px] text-[12px] text-muted-foreground">Couldn&apos;t load customers.</div>
      ) : loading || customers === null ? (
        <div className="space-y-3 mt-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="h-3 w-3 rounded-sm flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="flex justify-between"><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-12" /></div>
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="flex items-center justify-center h-[160px] text-[12px] text-muted-foreground">No customers in this range.</div>
      ) : (
        <div className="space-y-3 mt-1">
          {customers.slice(0, 5).map((c, i) => (
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
  );
}
