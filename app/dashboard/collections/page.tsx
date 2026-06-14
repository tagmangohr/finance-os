export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { Receipt, Percent, Clock, Users } from "lucide-react";
import { getOrgId, getCollectionsData } from "@/lib/data";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { PreviewBanner } from "@/components/dashboard/preview-banner";
import { formatCurrency } from "@/lib/utils";

type DebtorLite = { name: string; outstanding_amount: number };

const SAMPLE = {
  totalOutstanding: 540000, collectionRate: 86,
  aging: { overdue030: 180000, overdue3160: 120000, overdue6190: 70000, overdue90plus: 40000 },
  debtors: [
    { name: "Acme Corp", outstanding_amount: 180000 },
    { name: "Globex", outstanding_amount: 120000 },
    { name: "Initech", outstanding_amount: 90000 },
    { name: "Umbrella Co", outstanding_amount: 85000 },
    { name: "Soylent", outstanding_amount: 65000 },
  ] as DebtorLite[],
};

export default async function CollectionsPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");

  const real = await getCollectionsData(orgId);
  const preview = real.totalOutstanding === 0 && real.debtors.length === 0;

  const v = preview ? SAMPLE : {
    totalOutstanding: real.totalOutstanding,
    collectionRate: real.collectionRate,
    aging: {
      overdue030: real.aging.overdue030, overdue3160: real.aging.overdue3160,
      overdue6190: real.aging.overdue6190, overdue90plus: real.aging.overdue90plus,
    },
    debtors: (real.debtors as unknown as DebtorLite[]).map((d) => ({ name: d.name, outstanding_amount: d.outstanding_amount ?? 0 })),
  };

  const buckets = [
    { label: "0–30 days",  amount: v.aging.overdue030,    color: "hsl(var(--warning))" },
    { label: "31–60 days", amount: v.aging.overdue3160,   color: "hsl(var(--metric-opex))" },
    { label: "61–90 days", amount: v.aging.overdue6190,   color: "hsl(var(--metric-runway))" },
    { label: "90+ days",   amount: v.aging.overdue90plus, color: "hsl(var(--destructive))" },
  ];
  const maxBucket = Math.max(...buckets.map((b) => b.amount), 1);
  const overdueTotal = buckets.reduce((s, b) => s + b.amount, 0);
  const maxDebtor = Math.max(...v.debtors.map((d) => d.outstanding_amount), 1);

  return (
    <div className="space-y-3 max-w-[1400px]">
      {preview && <PreviewBanner />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter">
        <MetricCard title="Outstanding" value={formatCurrency(v.totalOutstanding, "INR", true)} subtitle="total receivable"
          icon={<Receipt className="w-4 h-4" />} accentColor="hsl(var(--metric-margin))" />
        <MetricCard title="Collection Rate" value={`${Math.round(v.collectionRate)}%`} subtitle="of invoiced"
          icon={<Percent className="w-4 h-4" />} accentColor="hsl(var(--metric-profit))" />
        <MetricCard title="Overdue" value={formatCurrency(overdueTotal, "INR", true)} subtitle="past due date"
          icon={<Clock className="w-4 h-4" />} accentColor="hsl(var(--metric-runway))" />
        <MetricCard title="Debtors" value={String(v.debtors.length)} subtitle="with balance"
          icon={<Users className="w-4 h-4" />} accentColor="hsl(var(--metric-cash))" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-1">
        <SectionCard title="Aging" subtitle="overdue by bucket">
          <div className="space-y-3 mt-1">
            {buckets.map((b) => (
              <div key={b.label} className="flex items-center gap-2.5 text-[11.5px]">
                <span className="text-muted-foreground w-[72px] flex-shrink-0">{b.label}</span>
                <span className="flex-1 h-2 rounded-full bg-accent overflow-hidden">
                  <span className="block h-full rounded-full" style={{ width: `${(b.amount / maxBucket) * 100}%`, background: b.color }} />
                </span>
                <span className="num text-foreground/70 w-[56px] text-right flex-shrink-0">{formatCurrency(b.amount, "INR", true)}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Top Debtors" className="lg:col-span-2">
          {v.debtors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[160px] gap-2">
              <div className="h-9 w-9 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
                <span className="text-success">✓</span>
              </div>
              <p className="text-[12px] text-muted-foreground">No outstanding receivables</p>
            </div>
          ) : (
            <div className="space-y-2.5 mt-1">
              {v.debtors.slice(0, 6).map((d, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-primary/10 text-primary border border-primary/15">{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[12px] text-foreground/80 truncate">{d.name}</span>
                      <span className="num text-[11.5px] font-semibold text-foreground/70 flex-shrink-0">{formatCurrency(d.outstanding_amount, "INR", true)}</span>
                    </div>
                    <span className="block h-1.5 rounded-full bg-accent overflow-hidden">
                      <span className="block h-full rounded-full bg-metric-margin" style={{ width: `${(d.outstanding_amount / maxDebtor) * 100}%` }} />
                    </span>
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
