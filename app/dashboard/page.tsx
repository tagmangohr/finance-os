export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import Link from "next/link";
import { Zap, Sparkles, ArrowRight } from "lucide-react";
import { getFinancialSummary, getOrgId, orgHasConnectors } from "@/lib/data";
import { requireRouteAccess } from "@/lib/org/page-access";
import type { DashboardSummary } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { SectionCard } from "@/components/dashboard/section-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricStrip } from "@/components/dashboard/metric-strip";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { CategoryChart } from "@/components/charts/category-chart";
import { InflowOutflowChart } from "@/components/charts/inflow-outflow-chart";
import { METRICS } from "@/lib/metrics/registry";
import { getMetricPrefs, defaultPrefs } from "@/lib/metrics/prefs";
import { SAMPLE_METRIC_DATA } from "@/lib/metrics/sample";
import type { ComputedMetric } from "@/lib/metrics/types";
import { formatCurrency, formatRunway } from "@/lib/utils";

// ─── View model ──────────────────────────────────────────────────────
type DebtorLite = { id: string; name: string; outstanding_amount: number };
type View = {
  preview: boolean;
  cash: number; runwayDays: number; mrr: number; burn: number; receivables: number;
  cashSpark: number[]; mrrSpark: number[];
  mrrGrowth: number | null; burnChange: number | null;
  inflowOutflow: { label: string; inflow: number; outflow: number }[];
  expenses: { category: string; amount: number; pct: number }[];
  revenue: { month: string; amount: number }[];
  debtors: DebtorLite[];
  healthScore: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Rich sample data so the dashboard looks fully alive before any source is connected.
const SAMPLE: View = {
  preview: true,
  cash: 14200000, runwayDays: 426, mrr: 820000, burn: 920000, receivables: 540000,
  cashSpark: [11000000, 11500000, 12000000, 12400000, 13000000, 13200000, 13800000, 14200000],
  mrrSpark: [540000, 590000, 610000, 660000, 700000, 740000, 780000, 820000],
  mrrGrowth: 12, burnChange: 6,
  inflowOutflow: [
    { label: "Feb", inflow: 620000, outflow: 500000 },
    { label: "Mar", inflow: 680000, outflow: 460000 },
    { label: "Apr", inflow: 550000, outflow: 580000 },
    { label: "May", inflow: 800000, outflow: 400000 },
    { label: "Jun", inflow: 720000, outflow: 600000 },
    { label: "Jul", inflow: 900000, outflow: 480000 },
    { label: "Aug", inflow: 660000, outflow: 540000 },
    { label: "Sep", inflow: 840000, outflow: 420000 },
  ],
  expenses: [
    { category: "Production", amount: 2304200, pct: 48 },
    { category: "Marketing", amount: 1223000, pct: 25 },
    { category: "Logistics", amount: 540500, pct: 11 },
    { category: "People", amount: 420000, pct: 9 },
    { category: "Operations", amount: 210000, pct: 4 },
    { category: "Other", amount: 120000, pct: 3 },
  ],
  revenue: [
    { month: "2024-07", amount: 520000 }, { month: "2024-08", amount: 560000 },
    { month: "2024-09", amount: 540000 }, { month: "2024-10", amount: 600000 },
    { month: "2024-11", amount: 640000 }, { month: "2024-12", amount: 700000 },
    { month: "2025-01", amount: 680000 }, { month: "2025-02", amount: 720000 },
    { month: "2025-03", amount: 760000 }, { month: "2025-04", amount: 790000 },
    { month: "2025-05", amount: 800000 }, { month: "2025-06", amount: 820000 },
  ],
  debtors: [
    { id: "s1", name: "Acme Corp", outstanding_amount: 180000 },
    { id: "s2", name: "Globex", outstanding_amount: 120000 },
    { id: "s3", name: "Initech", outstanding_amount: 90000 },
    { id: "s4", name: "Umbrella Co", outstanding_amount: 85000 },
    { id: "s5", name: "Soylent", outstanding_amount: 65000 },
  ],
  healthScore: 78,
};

function buildReal(s: DashboardSummary): View {
  // Aggregate daily cash flow into the last ~8 months for the grouped bars.
  const byMonth = new Map<string, { inflow: number; outflow: number }>();
  for (const d of s.cashFlowData) {
    const key = d.date.slice(0, 7);
    const cur = byMonth.get(key) ?? { inflow: 0, outflow: 0 };
    cur.inflow += d.inflow; cur.outflow += d.outflow;
    byMonth.set(key, cur);
  }
  const inflowOutflow = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1] ?? k, inflow: v.inflow, outflow: v.outflow }));

  const runwayMonths = s.runwayDays / 30;
  const healthScore = Math.max(0, Math.min(100, Math.round(
    (Math.min(runwayMonths, 18) / 18) * 60 + (s.burnRate > 0 ? Math.min(s.mrr / s.burnRate, 1) : 1) * 40
  )));

  return {
    preview: false,
    cash: s.cashBalance, runwayDays: s.runwayDays, mrr: s.mrr, burn: s.burnRate,
    receivables: s.topDebtors.reduce((a, d) => a + (d.outstanding_amount ?? 0), 0),
    cashSpark: s.cashFlowData.slice(-12).map((c) => c.balance),
    mrrSpark: s.revenueByMonth.slice(-8).map((r) => r.amount),
    mrrGrowth: s.mrrGrowth || null, burnChange: s.burnChange || null,
    inflowOutflow,
    expenses: s.categoryBreakdown,
    revenue: s.revenueByMonth,
    debtors: s.topDebtors.map((d) => ({ id: d.id, name: d.name, outstanding_amount: d.outstanding_amount })),
    healthScore,
  };
}

function Signal({ label, tone }: { label: string; tone: "good" | "warn" | "bad" }) {
  const dot = tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}
function Unit({ label, value, color }: { label: string; value?: string; color?: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {value ? (
        <p className="text-[16px] font-semibold" style={color ? { color } : undefined}>{value}</p>
      ) : (
        <span className="inline-block mt-1 text-[10px] font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5">add data</span>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  // A restricted member with no dashboard-tab access is redirected to their
  // first allowed page (e.g. Connectors or Raw Data).
  await requireRouteAccess("dashboard");

  const summary = await getFinancialSummary();
  // Sample preview only when nothing is connected yet; a connected org sees its
  // real data even if metrics are still empty (e.g. mid-sync) — never fabricated.
  const preview = !(await orgHasConnectors(orgId));
  const v = preview ? SAMPLE : buildReal(summary);

  // Customizable metric strip: compute every catalog metric from the aggregated
  // data (sample data in preview so it looks alive), then load the user's pins.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const metricData = preview ? SAMPLE_METRIC_DATA : summary.metricData;
  const computed: Record<string, ComputedMetric> = {};
  for (const m of METRICS) computed[m.key] = m.compute(metricData);
  const prefs = user ? await getMetricPrefs(user.id, orgId, supabase) : defaultPrefs();

  const runwayMonths = v.runwayDays / 30;
  const ringC = 2 * Math.PI * 40;
  const ringDash = (v.healthScore / 100) * ringC;

  return (
    <div className="space-y-3 max-w-[1400px]">

      <PageHeader title="Overview" subtitle="Your money across every gateway and account, at a glance" />

      {/* Preview banner (sample data) */}
      {v.preview && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5 animate-enter">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-[12.5px] text-foreground/80 flex-1 min-w-0">
            <span className="font-semibold text-foreground">Preview — sample data.</span>{" "}
            Connect a source to replace this with your real numbers.
          </p>
          <Link href="/dashboard/connectors" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0">
            <Zap className="h-3.5 w-3.5" /> Connect
          </Link>
        </div>
      )}

      {/* Customizable key-metrics strip */}
      <div className="animate-enter">
        <MetricStrip
          computed={computed}
          initialPinned={prefs.pinned}
          initialVisibleCount={prefs.visibleCount}
          orgId={orgId}
        />
      </div>

      {/* Inflow vs outflow + expense donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-1">
        <SectionCard title="Inflow vs Outflow" subtitle="last 8 months" className="lg:col-span-2"
          action={<span className="text-[11px] text-muted-foreground"><span className="text-metric-revenue">●</span> in <span className="text-metric-runway">●</span> out</span>}>
          <InflowOutflowChart data={v.inflowOutflow} />
        </SectionCard>
        <SectionCard title="Expense Breakdown">
          <CategoryChart data={v.expenses} />
        </SectionCard>
      </div>

      {/* Health ring + unit economics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-2">
        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
          <svg viewBox="0 0 96 96" width="92" height="92" className="flex-shrink-0" role="img" aria-label={`Financial health score ${v.healthScore}`}>
            <circle cx="48" cy="48" r="40" fill="none" stroke="hsl(var(--accent))" strokeWidth="9" />
            <circle cx="48" cy="48" r="40" fill="none" stroke="hsl(var(--metric-profit))" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${ringDash} ${ringC}`} transform="rotate(-90 48 48)" />
            <text x="48" y="46" textAnchor="middle" className="fill-foreground" style={{ fontSize: 22, fontWeight: 700 }}>{v.healthScore}</text>
            <text x="48" y="62" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 9 }}>health</text>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground mb-2">Financial health</p>
            <div className="space-y-1.5 text-[11.5px]">
              <Signal label={`Runway ${formatRunway(v.runwayDays)}`} tone={runwayMonths >= 12 ? "good" : runwayMonths >= 6 ? "warn" : "bad"} />
              <Signal label={`Burn ${formatCurrency(v.burn, "INR", true)}/mo`} tone={v.burn === 0 || v.mrr >= v.burn ? "good" : "warn"} />
              <Signal label={`MRR ${formatCurrency(v.mrr, "INR", true)}`} tone={v.mrr > 0 ? "good" : "bad"} />
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-4">
          <p className="text-[13px] font-semibold text-foreground mb-3">Unit economics</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
            <Unit label="MRR" value={formatCurrency(v.mrr, "INR", true)} color="hsl(var(--metric-revenue))" />
            <Unit label="ARR" value={formatCurrency(v.mrr * 12, "INR", true)} color="hsl(var(--metric-profit))" />
            <Unit label="Customers" value={metricData.customers.paying > 0 ? metricData.customers.paying.toLocaleString("en-IN") : undefined} color="hsl(var(--metric-cash))" />
            <Unit label="ARPU" value={computed.arpu?.available ? computed.arpu.display : undefined} color="hsl(var(--metric-margin))" />
            <Unit label="CAC" />
            <Unit label="LTV / CAC" />
          </div>
        </div>
      </div>

      {/* Revenue trend + top debtors */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-3">
        <SectionCard title="Revenue" subtitle="last 12 months" className="lg:col-span-2">
          <RevenueChart data={v.revenue} />
        </SectionCard>
        <SectionCard title="Top Debtors">
          {v.debtors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] gap-2">
              <div className="h-9 w-9 rounded-full bg-success/10 border border-success/20 flex items-center justify-center">
                <span className="text-success">✓</span>
              </div>
              <p className="text-[12px] text-muted-foreground">No outstanding receivables</p>
            </div>
          ) : (
            <div className="space-y-2 mt-1">
              {v.debtors.slice(0, 5).map((d, idx) => (
                <div key={d.id} className="flex items-center gap-2.5 group">
                  <div className="h-6 w-6 rounded-md flex items-center justify-center text-[10px] font-bold flex-shrink-0 bg-primary/10 text-primary border border-primary/15">
                    {idx + 1}
                  </div>
                  <p className="text-[12px] text-muted-foreground truncate flex-1 group-hover:text-foreground transition-colors">{d.name}</p>
                  <p className="num text-[12px] font-semibold text-foreground/80 flex-shrink-0">
                    {formatCurrency(d.outstanding_amount, "INR", true)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Connect CTA (only in preview, footer) */}
      {v.preview && (
        <Link href="/dashboard/connectors" className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-accent/30 py-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors animate-enter-4">
          Connect a payment gateway or accounting tool to see your own numbers
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
