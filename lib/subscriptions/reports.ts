import { createServiceClient } from "@/lib/supabase/server";

// ─── Subscriptions dashboard data layer ─────────────────────────────────────────
// All aggregation runs in Postgres (migrations 061-065 RPCs); we never sum rows in JS.
// Status model (migration 061): a DERIVED period-end drives it —
//   active   = not cancelled/expired/paused AND period_end >= today
//   past-due = not cancelled/expired/paused AND period_end lapsed, within grace (revivable)
//   churned  = cancelled/expired/paused, OR lapsed beyond grace
// period_end = gateway next_charge/period_end, else last successful charge + interval.
// Customer lists are NOT loaded here — the page fetches them page-by-page from
// /api/subscriptions/list (server-paginated by derived segment).

export type Seg = { subs: number; mrr: number };
export type MonthRow = {
  month: string; active: number; mrr: number; pastDue: number; pastDueMrr: number;
  newSubs: number; newMrr: number; churnedSubs: number; churnedMrr: number;
  netNewMrr: number; renewalCount: number; renewalAmount: number;
};
export type SubscriptionsOverview = {
  grace: number;
  now: { active: Seg; pastDue: Seg; churned: Seg; totalCustomers: number; arr: number; arpu: number };
  kpis: {
    netNewMrr: number; mrrGrowthPct: number | null;
    logoChurnPct: number | null; revChurnPct: number | null; nrrPct: number | null;
    quickRatio: number | null; avgLifetimeMonths: number | null; ltv: number | null;
    renewalsThisMonth: number; renewalSuccessPct: number | null;
    concentrationPct: number | null; annualSharePct: number | null;
  };
  contractMix: Array<{ interval: string; subs: number; mrr: number }>;
  byGateway: Array<{ gateway: string; active: number; activeMrr: number; pastDue: number; pastDueMrr: number; churned: number }>;
  monthly: MonthRow[];
  monthlyByGateway: Array<{ month: string; gateway: string; active: number; mrr: number; pastDue: number; newSubs: number; churnedSubs: number }>;
  cohorts: Array<{ cohort: string; size: number; pct: Array<number | null> }>;
  cohortPeriods: number;
};

function istMonthStart12(d: Date): string {
  return `${d.getUTCFullYear() - 1}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function getSubscriptionsOverview(orgId: string, grace = 1): Promise<SubscriptionsOverview> {
  const sb = await createServiceClient();
  const now = new Date();
  const fromDate = istMonthStart12(now);
  const toDate = now.toISOString().slice(0, 10);
  const curMonth = toDate.slice(0, 7);
  const curMonthStart = `${curMonth}-01`;
  const COHORT_PERIODS = 12;

  const [statusNow, monthly, renewals, cohortRows, mix, top10, renewOk, renewFail] = await Promise.all([
    sb.rpc("subscription_status_now", { p_org: orgId, p_grace_months: grace }).then((r) => r.data ?? []),
    sb.rpc("subscription_monthly_metrics", { p_org: orgId, p_from: fromDate, p_to: toDate, p_grace_months: grace }).then((r) => r.data ?? []),
    sb.rpc("subscription_renewals_monthly", { p_org: orgId, p_from: fromDate, p_to: toDate }).then((r) => r.data ?? []),
    sb.rpc("subscription_cohort_retention", { p_org: orgId, p_from: fromDate, p_to: toDate, p_periods: COHORT_PERIODS, p_grace_months: grace }).then((r) => r.data ?? []),
    sb.rpc("subscription_mix_now", { p_org: orgId, p_grace_months: grace }).then((r) => r.data ?? []),
    sb.rpc("subscription_list", { p_org: orgId, p_segment: "active", p_grace_months: grace, p_sort: "mrr", p_limit: 10, p_offset: 0 }).then((r) => r.data ?? []),
    sb.from("transactions").select("*", { count: "exact", head: true }).eq("org_id", orgId).not("subscription_id", "is", null).eq("type", "credit").eq("status", "completed").gte("transaction_date", curMonthStart).then((r) => r.count ?? 0),
    sb.from("transactions").select("*", { count: "exact", head: true }).eq("org_id", orgId).not("subscription_id", "is", null).eq("type", "credit").eq("status", "failed").gte("transaction_date", curMonthStart).then((r) => r.count ?? 0),
  ]);

  // ── Current-state segments ──
  const now_ = { active: { subs: 0, mrr: 0 }, pastDue: { subs: 0, mrr: 0 }, churned: { subs: 0, mrr: 0 } };
  const gwMap = new Map<string, { gateway: string; active: number; activeMrr: number; pastDue: number; pastDueMrr: number; churned: number }>();
  const gw = (g: string) => gwMap.get(g) ?? gwMap.set(g, { gateway: g, active: 0, activeMrr: 0, pastDue: 0, pastDueMrr: 0, churned: 0 }).get(g)!;
  for (const r of statusNow as Array<Record<string, unknown>>) {
    const seg = String(r.segment), g = gw(String(r.gateway));
    const subs = Number(r.subs) || 0, mrr = Number(r.mrr) || 0;
    if (seg === "active") { now_.active.subs += subs; now_.active.mrr += mrr; g.active += subs; g.activeMrr += mrr; }
    else if (seg === "past_due") { now_.pastDue.subs += subs; now_.pastDue.mrr += mrr; g.pastDue += subs; g.pastDueMrr += mrr; }
    else { now_.churned.subs += subs; now_.churned.mrr += mrr; g.churned += subs; }
  }
  const totalCustomers = now_.active.subs + now_.pastDue.subs;
  const arr = now_.active.mrr * 12;
  const arpu = now_.active.subs ? now_.active.mrr / now_.active.subs : 0;

  // ── Monthly series ──
  const renByMonth = new Map<string, { count: number; amount: number }>();
  for (const r of renewals as Array<Record<string, unknown>>) {
    const m = String(r.month).slice(0, 7);
    const cur = renByMonth.get(m) ?? { count: 0, amount: 0 };
    cur.count += Number(r.renewal_count) || 0; cur.amount += Number(r.renewal_amount) || 0;
    renByMonth.set(m, cur);
  }
  const mAgg = new Map<string, MonthRow>();
  const monthlyByGateway: SubscriptionsOverview["monthlyByGateway"] = [];
  for (const r of monthly as Array<Record<string, unknown>>) {
    const m = String(r.month).slice(0, 7);
    const row = mAgg.get(m) ?? { month: m, active: 0, mrr: 0, pastDue: 0, pastDueMrr: 0, newSubs: 0, newMrr: 0, churnedSubs: 0, churnedMrr: 0, netNewMrr: 0, renewalCount: 0, renewalAmount: 0 };
    row.active += Number(r.active_eom) || 0; row.mrr += Number(r.mrr_eom) || 0;
    row.pastDue += Number(r.pastdue_eom) || 0; row.pastDueMrr += Number(r.pastdue_mrr) || 0;
    row.newSubs += Number(r.new_subs) || 0; row.newMrr += Number(r.new_mrr) || 0;
    row.churnedSubs += Number(r.churned_subs) || 0; row.churnedMrr += Number(r.churned_mrr) || 0;
    mAgg.set(m, row);
    monthlyByGateway.push({ month: m, gateway: String(r.gateway), active: Number(r.active_eom) || 0, mrr: Math.round(Number(r.mrr_eom) || 0), pastDue: Number(r.pastdue_eom) || 0, newSubs: Number(r.new_subs) || 0, churnedSubs: Number(r.churned_subs) || 0 });
  }
  const monthlyArr = [...mAgg.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => {
    const ren = renByMonth.get(r.month);
    r.renewalCount = ren?.count ?? 0; r.renewalAmount = Math.round(ren?.amount ?? 0);
    r.netNewMrr = r.newMrr - r.churnedMrr;
    return r;
  });
  const curRow = monthlyArr.find((r) => r.month === curMonth);
  if (curRow) { curRow.active = now_.active.subs; curRow.mrr = now_.active.mrr; curRow.pastDue = now_.pastDue.subs; curRow.pastDueMrr = now_.pastDue.mrr; }
  for (const r of monthlyArr) { r.mrr = Math.round(r.mrr); r.newMrr = Math.round(r.newMrr); r.churnedMrr = Math.round(r.churnedMrr); r.pastDueMrr = Math.round(r.pastDueMrr); r.netNewMrr = Math.round(r.netNewMrr); }

  // ── Derived KPIs ──
  const complete = monthlyArr.filter((r) => r.month !== curMonth);
  const lastC = complete[complete.length - 1];
  const prevC = complete[complete.length - 2];
  const netNewMrr = now_.active.mrr - (lastC?.mrr ?? now_.active.mrr);
  const mrrGrowthPct = lastC && lastC.mrr ? ((now_.active.mrr - lastC.mrr) / lastC.mrr) * 100 : null;
  const logoChurnPct = lastC && prevC && prevC.active ? (lastC.churnedSubs / prevC.active) * 100 : null;
  const revChurnPct = lastC && prevC && prevC.mrr ? (lastC.churnedMrr / prevC.mrr) * 100 : null;
  const nrrPct = revChurnPct != null ? 100 - revChurnPct : null;
  const quickRatio = lastC ? (lastC.churnedMrr > 0 ? lastC.newMrr / lastC.churnedMrr : (lastC.newMrr > 0 ? Infinity : null)) : null;
  const avgLifetimeMonths = logoChurnPct && logoChurnPct > 0 ? 100 / logoChurnPct : null;
  const ltv = avgLifetimeMonths != null ? arpu * avgLifetimeMonths : null;
  const renewalsThisMonth = Math.round(renByMonth.get(curMonth)?.amount ?? 0);
  const renewTotal = (renewOk as number) + (renewFail as number);
  const renewalSuccessPct = renewTotal ? ((renewOk as number) / renewTotal) * 100 : null;
  const top10Mrr = (top10 as Array<Record<string, unknown>>).reduce((sum, r) => sum + (Number(r.mrr) || 0), 0);
  const concentrationPct = now_.active.mrr ? (top10Mrr / now_.active.mrr) * 100 : null;
  const contractMix = (mix as Array<Record<string, unknown>>).map((r) => ({ interval: String(r.billing_interval), subs: Number(r.subs) || 0, mrr: Math.round(Number(r.mrr) || 0) })).sort((a, b) => b.mrr - a.mrr);
  const annualMrr = contractMix.filter((m) => m.interval === "year").reduce((s, m) => s + m.mrr, 0);
  const annualSharePct = now_.active.mrr ? (annualMrr / now_.active.mrr) * 100 : null;

  // ── Cohort matrix ──
  const cohMap = new Map<string, { size: number; retained: Map<number, number> }>();
  for (const r of cohortRows as Array<Record<string, unknown>>) {
    const c = String(r.cohort).slice(0, 7);
    const e = cohMap.get(c) ?? { size: 0, retained: new Map() };
    e.size = Number(r.cohort_size) || 0; e.retained.set(Number(r.k), Number(r.retained) || 0);
    cohMap.set(c, e);
  }
  const cohorts = [...cohMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([cohort, e]) => ({
    cohort, size: e.size,
    pct: Array.from({ length: COHORT_PERIODS + 1 }, (_, k) => (e.retained.has(k) && e.size ? (e.retained.get(k)! / e.size) * 100 : null)),
  }));

  const byGateway = [...gwMap.values()].filter((g) => g.active || g.pastDue || g.churned).sort((a, b) => b.activeMrr - a.activeMrr)
    .map((g) => ({ ...g, activeMrr: Math.round(g.activeMrr), pastDueMrr: Math.round(g.pastDueMrr) }));

  const r1 = (n: number | null) => (n == null || !Number.isFinite(n) ? (n === Infinity ? Infinity : null) : Math.round(n * 10) / 10);

  return {
    grace,
    now: {
      active: { subs: now_.active.subs, mrr: Math.round(now_.active.mrr) },
      pastDue: { subs: now_.pastDue.subs, mrr: Math.round(now_.pastDue.mrr) },
      churned: { subs: now_.churned.subs, mrr: Math.round(now_.churned.mrr) },
      totalCustomers, arr: Math.round(arr), arpu: Math.round(arpu),
    },
    kpis: {
      netNewMrr: Math.round(netNewMrr), mrrGrowthPct: r1(mrrGrowthPct),
      logoChurnPct: r1(logoChurnPct), revChurnPct: r1(revChurnPct), nrrPct: r1(nrrPct),
      quickRatio: quickRatio === Infinity ? Infinity : r1(quickRatio),
      avgLifetimeMonths: r1(avgLifetimeMonths), ltv: ltv == null ? null : Math.round(ltv),
      renewalsThisMonth, renewalSuccessPct: r1(renewalSuccessPct),
      concentrationPct: r1(concentrationPct), annualSharePct: r1(annualSharePct),
    },
    contractMix, byGateway, monthly: monthlyArr,
    monthlyByGateway: monthlyByGateway.sort((a, b) => a.month.localeCompare(b.month) || a.gateway.localeCompare(b.gateway)),
    cohorts, cohortPeriods: COHORT_PERIODS,
  };
}
