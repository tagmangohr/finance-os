import { getPnl, CM_CONFIG, fyLabel, type PnlRow } from "@/lib/pnl";
import { getForecast } from "@/lib/forecast";

// ─── Types ──────────────────────────────────────────────────────────────────
export interface VarianceRow {
  id: string;
  label: string;
  kind: PnlRow["kind"];
  emphasis?: "strong" | "cm";
  section?: string;
  drill?: string;
  actual: Record<string, number>;   // ₹ per month
  plan: Record<string, number>;     // ₹ per month (trend plan)
  pctBaseId?: string;               // margin/CM rows: % base row id
  numeratorId?: string;
}

export interface VarianceData {
  fyStart: number;
  periodLabel: string;
  months: { key: string; label: string }[];
  elapsedKeys: string[];            // months with real actuals (≤ current month)
  rows: VarianceRow[];
  hasData: boolean;
  preview: boolean;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mk = (y: number, m1: number) => `${y}-${String(m1).padStart(2, "0")}`;
function fyMonthKeys(fyStart: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month0 = (3 + i) % 12;
    const year = 3 + i < 12 ? fyStart : fyStart + 1;
    out.push(mk(year, month0 + 1));
  }
  return out;
}
const monthLabelOf = (key: string) => { const [y, m] = key.split("-").map(Number); return `${MONTH_ABBR[m - 1]} ${String(y).slice(2)}`; };

// Map a P&L row to its Forecast component slug (or null for a derived row).
function componentSlug(rowId: string): string | null {
  if (rowId === "gross_revenue") return "__gross__";
  if (rowId === "refunds") return "__refunds__";
  if (rowId.startsWith("exp_")) return rowId.slice(4); // 'exp___pg_fees__'→'__pg_fees__', 'exp_ai_model'→'ai_model'
  return null;
}
const isComponentKind = (k: PnlRow["kind"]) => k === "revenue" || k === "deduction" || k === "expense";

// ─── main loader ───────────────────────────────────────────────────────────────
export async function getVariance(orgId: string, fyStart: number, today = new Date()): Promise<VarianceData> {
  const monthKeys = fyMonthKeys(fyStart);
  const firstKey = monthKeys[0];
  const currentKey = mk(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const elapsedKeys = monthKeys.filter((k) => k <= currentKey);

  // Actuals: the P&L monthly rows (structure + monthly series). Growth: the
  // Forecast seed model (trend per component line).
  const [pnl, forecast] = await Promise.all([
    getPnl(orgId, { mode: "monthly", fyStart, years: 5 }),
    getForecast(orgId, today),
  ]);
  const growthOf = new Map(forecast.components.map((c) => [c.slug, c.growthPct]));

  // Plan component series: seed from the FY's first-month actual, compound at trend.
  const planComp = new Map<string, Record<string, number>>();
  for (const row of pnl.rows) {
    if (!isComponentKind(row.kind)) continue;
    const slug = componentSlug(row.id);
    if (!slug) continue;
    const seed = row.monthly[firstKey] ?? 0;
    const g = (growthOf.get(slug) ?? 0) / 100;
    const series: Record<string, number> = {};
    monthKeys.forEach((k, i) => { series[k] = seed * Math.pow(1 + g, i); });
    planComp.set(slug, series);
  }

  const planCat = (slug: string, k: string) => planComp.get(slug)?.[k] ?? 0;
  const expenseSlugs = [...planComp.keys()].filter((s) => s !== "__gross__" && s !== "__refunds__");
  const cmCats = new Set(CM_CONFIG.flatMap((t) => t.cats).filter((s) => s !== "__pg_fees__"));

  // Derived plan series.
  const planNetRev: Record<string, number> = {}, planOpex: Record<string, number> = {}, planNetProfit: Record<string, number> = {};
  const planCm: Record<string, Record<string, number>> = Object.fromEntries(CM_CONFIG.map((t) => [t.id, {}]));
  for (const k of monthKeys) {
    const gross = planCat("__gross__", k), refunds = planCat("__refunds__", k), fees = planCat("__pg_fees__", k);
    const nr = gross - refunds;
    planNetRev[k] = nr;
    const opexCats = expenseSlugs.filter((s) => s !== "__pg_fees__").reduce((a, s) => a + planCat(s, k), 0);
    planOpex[k] = fees + opexCats;
    planNetProfit[k] = nr - planOpex[k];
    let running = nr;
    for (const t of CM_CONFIG) { running -= t.cats.reduce((a, s) => a + planCat(s, k), 0); planCm[t.id][k] = running; }
  }

  const planForRow = (row: PnlRow): Record<string, number> => {
    if (isComponentKind(row.kind)) { const s = componentSlug(row.id); return (s && planComp.get(s)) || {}; }
    if (row.id === "net_revenue") return planNetRev;
    if (row.id === "total_opex") return planOpex;
    if (row.id === "net_profit") return planNetProfit;
    if (planCm[row.id]) return planCm[row.id];
    return {}; // margin — derived by the client from net_profit/net_revenue plan
  };

  const rows: VarianceRow[] = pnl.rows.map((row) => ({
    id: row.id, label: row.label, kind: row.kind, emphasis: row.emphasis, section: row.section, drill: row.drill,
    actual: row.monthly, plan: planForRow(row), pctBaseId: row.pctBaseId, numeratorId: row.numeratorId,
  }));

  return {
    fyStart,
    periodLabel: fyLabel(fyStart),
    months: monthKeys.map((k) => ({ key: k, label: monthLabelOf(k) })),
    elapsedKeys,
    rows,
    hasData: pnl.hasData,
    preview: false,
  };
}

// ─── sample (preview) ──────────────────────────────────────────────────────────
export function sampleVariance(fyStart: number, today = new Date()): VarianceData {
  const monthKeys = fyMonthKeys(fyStart);
  const currentKey = mk(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const elapsedKeys = monthKeys.filter((k) => k <= currentKey);
  // Reuse the P&L sample shape by hand: a few lines with plan vs a jittered actual.
  const base: [string, string, PnlRow["kind"], "strong" | "cm" | undefined, number][] = [
    ["gross_revenue", "Gross Revenue", "revenue", "strong", 24000000],
    ["refunds", "Refunds", "deduction", undefined, 480000],
    ["net_revenue", "Net Revenue", "subtotal", "strong", 23520000],
    ["exp___pg_fees__", "Payment Gateway Fees", "deduction", undefined, 720000],
    ["exp_ai_model", "AI Model", "expense", undefined, 5300000],
    ["cm1", CM_CONFIG[0].label, "cm", "cm", 17500000],
    ["exp_marketing", "Marketing & Advertising", "expense", undefined, 2900000],
    ["cm2", CM_CONFIG[1].label, "cm", "cm", 14600000],
    ["total_opex", "Total Operating Expenses", "subtotal", "strong", 9820000],
    ["net_profit", "Net Profit / (Loss)", "total", undefined, 13700000],
    ["net_margin", "Net Margin %", "margin", undefined, 0],
  ];
  const jitter = [1.0, 1.06, 0.98, 1.09, 0.94, 1.03, 1.11, 0.9, 1.05, 1.0, 0.97, 1.08];
  const rows: VarianceRow[] = base.map(([id, label, kind, emphasis, v]) => {
    const plan: Record<string, number> = {}, actual: Record<string, number> = {};
    monthKeys.forEach((k, i) => {
      const p = Math.round(v * Math.pow(1.03, i));
      plan[k] = p;
      if (k <= currentKey) actual[k] = Math.round(p * jitter[i % jitter.length]);
    });
    return { id, label, kind, emphasis, actual: kind === "margin" ? {} : actual, plan: kind === "margin" ? {} : plan,
      pctBaseId: kind === "cm" || kind === "margin" ? "net_revenue" : undefined, numeratorId: id === "net_margin" ? "net_profit" : undefined };
  });
  return { fyStart, periodLabel: fyLabel(fyStart), months: monthKeys.map((k) => ({ key: k, label: monthLabelOf(k) })), elapsedKeys, rows, hasData: true, preview: true };
}
