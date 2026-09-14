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
import { InflowOutflowChart } from "@/components/charts/lazy";
import { MrrMovementPanel } from "@/components/dashboard/mrr-movement";
import { getMrrMovementCached, SAMPLE_MRR_MOVEMENT } from "@/lib/subscriptions/mrr-movement";
import { METRICS } from "@/lib/metrics/registry";
import { getMetricPrefs, defaultPrefs } from "@/lib/metrics/prefs";
import { SAMPLE_METRIC_DATA } from "@/lib/metrics/sample";
import type { ComputedMetric } from "@/lib/metrics/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type InflowRow = { label: string; inflow: number; outflow: number };

// Aggregate daily cash flow into the last ~8 months for the grouped bars.
function buildInflowOutflow(s: DashboardSummary): InflowRow[] {
  const byMonth = new Map<string, { inflow: number; outflow: number }>();
  for (const d of s.cashFlowData) {
    const key = d.date.slice(0, 7);
    const cur = byMonth.get(key) ?? { inflow: 0, outflow: 0 };
    cur.inflow += d.inflow; cur.outflow += d.outflow;
    byMonth.set(key, cur);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([k, v]) => ({ label: MONTHS[Number(k.slice(5, 7)) - 1] ?? k, inflow: v.inflow, outflow: v.outflow }));
}

// Sample inflow/outflow so the dashboard looks alive before any source is connected.
const SAMPLE_INFLOW: InflowRow[] = [
  { label: "Feb", inflow: 620000, outflow: 500000 },
  { label: "Mar", inflow: 680000, outflow: 460000 },
  { label: "Apr", inflow: 550000, outflow: 580000 },
  { label: "May", inflow: 800000, outflow: 400000 },
  { label: "Jun", inflow: 720000, outflow: 600000 },
  { label: "Jul", inflow: 900000, outflow: 480000 },
  { label: "Aug", inflow: 660000, outflow: 540000 },
  { label: "Sep", inflow: 840000, outflow: 420000 },
];

// ─── Page ────────────────────────────────────────────────────────────
export default async function DashboardPage() {
  const orgId = await getOrgId();
  if (!orgId) redirect("/auth/login");
  // A restricted member with no dashboard-tab access is redirected to their
  // first allowed page (e.g. Connectors or Raw Data).
  await requireRouteAccess("dashboard");

  // Fetch the summary, connector check, and MRR movement in parallel. MRR movement is
  // cached on its own 6h TTL, so it's cheap here; for a not-yet-connected org it returns
  // empty quickly and we render the sample instead.
  const [summary, hasConnectors, mrrReal] = await Promise.all([
    getFinancialSummary(),
    orgHasConnectors(orgId),
    getMrrMovementCached(orgId),
  ]);
  // Sample preview only when nothing is connected yet; a connected org sees its real
  // data even if metrics are still empty (e.g. mid-sync) — never fabricated.
  const preview = !hasConnectors;
  const inflowOutflow = preview ? SAMPLE_INFLOW : buildInflowOutflow(summary);
  const mrr = preview ? SAMPLE_MRR_MOVEMENT : mrrReal;

  // Customizable metric strip: compute every catalog metric from the aggregated data
  // (sample data in preview so it looks alive), then load the user's pins.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const metricData = preview ? SAMPLE_METRIC_DATA : summary.metricData;
  const computed: Record<string, ComputedMetric> = {};
  for (const m of METRICS) computed[m.key] = m.compute(metricData);
  const prefs = user ? await getMetricPrefs(user.id, orgId, supabase) : defaultPrefs();

  return (
    <div className="space-y-3 max-w-[1400px]">

      <PageHeader title="Overview" subtitle="Your money across every gateway and account, at a glance" />

      {/* Preview banner (sample data) */}
      {preview && (
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

      {/* Inflow vs outflow + MRR movement */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 animate-enter-1">
        <SectionCard title="Inflow vs Outflow" subtitle="last 8 months" className="lg:col-span-2"
          action={<span className="text-[11px] text-muted-foreground"><span className="text-metric-revenue">●</span> in <span className="text-metric-runway">●</span> out</span>}>
          <InflowOutflowChart data={inflowOutflow} />
        </SectionCard>
        <MrrMovementPanel data={mrr} />
      </div>

      {/* Connect CTA (only in preview, footer) */}
      {preview && (
        <Link href="/dashboard/connectors" className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-accent/30 py-3 text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors animate-enter-4">
          Connect a payment gateway or accounting tool to see your own numbers
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
