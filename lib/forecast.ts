import { createServiceClient } from "@/lib/supabase/server";
import { fyStartForDate } from "@/lib/pnl";

// ─── Types ──────────────────────────────────────────────────────────────────
// A projectable P&L component line. Derived rows (Net Revenue, CM tiers, Total
// OpEx, Net Profit, Net Margin) are computed on the client from these, so growth
// edits recompute instantly without a refetch.
export interface ForecastComponent {
  slug: string;            // '__gross__' | '__refunds__' | '__pg_fees__' | <category slug>
  label: string;
  kind: "revenue" | "deduction" | "expense";
  base: number;            // starting monthly level (trailing 3-month average, ₹)
  growthPct: number;       // seeded monthly growth %, editable on the client
}

export interface ForecastData {
  months: { key: string; label: string }[];
  components: ForecastComponent[];
  lastActualLabel: string;
  hasData: boolean;
  preview: boolean;
}

// ─── Month helpers (kept local to avoid widening lib/pnl's surface) ───────────
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mk = (y: number, m1: number) => `${y}-${String(m1).padStart(2, "0")}`;
function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return mk(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${String(y).slice(2)}`;
};
const lastDayIso = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
function monthSpan(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let cur = fromKey;
  for (let i = 0; i < 60 && cur <= toKey; i++) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
}

// Seed a base level + monthly growth from a trailing value series (oldest→newest).
function computeSeed(series: number[]): { base: number; growthPct: number } {
  const base = series.length ? series.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, series.length) : 0;
  const rates: number[] = [];
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] > 0) rates.push(series[i] / series[i - 1] - 1);
  }
  let g = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  g = Math.max(-0.15, Math.min(0.3, g)); // clamp to a sane -15%…+30% / month
  return { base, growthPct: Number((g * 100).toFixed(1)) };
}

// ─── Projection horizon: current month → FY-end → +12 months ──────────────────
function projectionMonths(today: Date): { months: { key: string; label: string }[]; lastActualLabel: string } {
  const curKey = mk(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const currentFy = fyStartForDate(today);
  const fyEnd = mk(currentFy + 1, 3);           // March of FY end
  const end = addMonths(fyEnd, 12);             // + next 12 months
  const keys = monthSpan(curKey, end < curKey ? curKey : end);
  return {
    months: keys.map((k) => ({ key: k, label: monthLabel(k) })),
    lastActualLabel: monthLabel(addMonths(curKey, -1)),
  };
}

// ─── Main loader ──────────────────────────────────────────────────────────────
export async function getForecast(orgId: string, today = new Date()): Promise<ForecastData> {
  const { months, lastActualLabel } = projectionMonths(today);

  // Trailing window: the 7 complete months before the current month.
  const curKey = mk(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const from = `${addMonths(curKey, -7)}-01`;
  const to = lastDayIso(addMonths(curKey, -1));
  const window = monthSpan(addMonths(curKey, -7), addMonths(curKey, -1)); // ordered month keys

  const supabase = await createServiceClient();
  const [monthlyRes, pnlRes] = await Promise.all([
    supabase.rpc("dash_metrics_monthly" as never, { p_org: orgId, p_from: from, p_to: to } as never),
    supabase.rpc("pnl_monthly" as never, { p_org: orgId, p_from: from, p_to: to } as never),
  ]);

  type MonthlyRow = { month: string; gross_revenue: number; refunds: number };
  type PnlCatRow = { month: string; category: string; label: string; amount: number };
  const monthly: MonthlyRow[] = (monthlyRes.data as MonthlyRow[]) ?? [];
  const catRows: PnlCatRow[] = (pnlRes.data as PnlCatRow[]) ?? [];

  const gross: Record<string, number> = {}, refunds: Record<string, number> = {}, fees: Record<string, number> = {};
  for (const r of monthly) { const k = r.month.slice(0, 7); gross[k] = Number(r.gross_revenue) || 0; refunds[k] = Number(r.refunds) || 0; }
  const cats = new Map<string, { label: string; values: Record<string, number> }>();
  for (const c of catRows) {
    const k = c.month.slice(0, 7);
    const amt = Number(c.amount) || 0;
    if (c.category === "__pg_fees__") { fees[k] = (fees[k] ?? 0) + amt; continue; }
    let e = cats.get(c.category);
    if (!e) { e = { label: c.label || c.category, values: {} }; cats.set(c.category, e); }
    e.values[k] = (e.values[k] ?? 0) + amt;
  }

  const seriesOf = (m: Record<string, number>) => window.map((k) => m[k] ?? 0);
  const components: ForecastComponent[] = [];
  const pushComp = (slug: string, label: string, kind: ForecastComponent["kind"], m: Record<string, number>) => {
    const present = window.some((k) => (m[k] ?? 0) !== 0);
    if (!present) return;
    const { base, growthPct } = computeSeed(seriesOf(m));
    components.push({ slug, label, kind, base, growthPct });
  };

  pushComp("__gross__", "Gross Revenue", "revenue", gross);
  pushComp("__refunds__", "Refunds", "deduction", refunds);
  pushComp("__pg_fees__", "Payment Gateway Fees", "deduction", fees);
  for (const [slug, c] of cats) pushComp(slug, c.label, "expense", c.values);

  return {
    months,
    components,
    lastActualLabel,
    hasData: monthly.length > 0 || catRows.length > 0,
    preview: false,
  };
}

// ─── Sample forecast (before any source is connected) ─────────────────────────
export function sampleForecast(today = new Date()): ForecastData {
  const { months, lastActualLabel } = projectionMonths(today);
  const components: ForecastComponent[] = [
    { slug: "__gross__", label: "Gross Revenue", kind: "revenue", base: 24000000, growthPct: 4 },
    { slug: "__refunds__", label: "Refunds", kind: "deduction", base: 480000, growthPct: 3 },
    { slug: "__pg_fees__", label: "Payment Gateway Fees", kind: "deduction", base: 720000, growthPct: 4 },
    { slug: "ai_model", label: "AI Model", kind: "expense", base: 5300000, growthPct: 3 },
    { slug: "cloud_infra", label: "Cloud & Infrastructure", kind: "expense", base: 300000, growthPct: 2 },
    { slug: "technical_expense", label: "Technical Expense", kind: "expense", base: 120000, growthPct: 1 },
    { slug: "marketing", label: "Marketing & Advertising", kind: "expense", base: 2900000, growthPct: 5 },
    { slug: "payroll", label: "Payroll", kind: "expense", base: 3400000, growthPct: 2 },
    { slug: "contractors", label: "Contractors & Freelancers", kind: "expense", base: 700000, growthPct: 1 },
    { slug: "professional", label: "Professional Services", kind: "expense", base: 600000, growthPct: 1 },
    { slug: "travel", label: "Travel", kind: "expense", base: 250000, growthPct: 0 },
    { slug: "software", label: "Software & SaaS", kind: "expense", base: 180000, growthPct: 1 },
  ];
  return { months, components, lastActualLabel, hasData: true, preview: true };
}
