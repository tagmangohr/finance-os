import { createServiceClient } from "@/lib/supabase/server";

// ─── Types ──────────────────────────────────────────────────────────────────
export type PnlRowKind = "revenue" | "deduction" | "subtotal" | "expense" | "total" | "margin";

export interface PnlRow {
  /** stable id for React keys */
  id: string;
  label: string;
  kind: PnlRowKind;
  /** value shown in each cell, keyed by 'YYYY-MM' (covers the 24-month window) */
  values: Record<string, number>;
  /** sum across the 12 DISPLAYED months of the selected FY */
  total: number;
  /** slice key for cell drill-down; absent = not drillable (subtotals/margin) */
  drill?: string;
}

export interface PnlData {
  fyStart: number;                 // e.g. 2026 → FY Apr-2026 … Mar-2027
  fyLabel: string;                 // "FY 2026-27"
  months: { key: string; label: string }[];   // 12 displayed months (Apr…Mar)
  rows: PnlRow[];
  hasData: boolean;
  preview: boolean;
}

// ─── FY helpers ───────────────────────────────────────────────────────────────
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The financial year (April-start) that a given IST date falls in. */
export function fyStartForDate(d: Date): number {
  // IST month (0-based). new Date() on the server is UTC; FY boundary tolerance
  // of a few hours around Apr 1 midnight is immaterial for a yearly selector.
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0 = Jan
  return m >= 3 ? y : y - 1;  // Jan–Mar belong to the previous FY
}

export function fyLabel(fyStart: number): string {
  return `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
}

/** 'YYYY-MM' for the given year/month(1-12). */
function mk(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

/** The 12 displayed months of an FY: Apr(fyStart) … Mar(fyStart+1). */
function fyMonths(fyStart: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < 12; i++) {
    const month0 = (3 + i) % 12;           // Apr=3 … Mar=2
    const year = 3 + i < 12 ? fyStart : fyStart + 1;
    out.push({ key: mk(year, month0 + 1), label: `${MONTH_ABBR[month0]} ${String(year).slice(2)}` });
  }
  return out;
}

const monthKeyFromDate = (iso: string): string => iso.slice(0, 7); // 'YYYY-MM-DD' → 'YYYY-MM'

// ─── Row assembly helpers ─────────────────────────────────────────────────────
function emptyValues(): Record<string, number> {
  return {};
}
function sumDisplayed(values: Record<string, number>, displayed: string[]): number {
  return displayed.reduce((a, k) => a + (values[k] ?? 0), 0);
}

// ─── Main loader ──────────────────────────────────────────────────────────────
export async function getPnl(orgId: string, fyStart: number): Promise<PnlData> {
  const months = fyMonths(fyStart);
  const displayedKeys = months.map((m) => m.key);

  // Fetch a 24-month window: prior FY + selected FY, so the client has the
  // previous month (for April's MoM) and same-month-last-year (for YoY).
  const from = `${fyStart - 1}-04-01`;
  const to = `${fyStart + 1}-03-31`;

  const supabase = await createServiceClient();
  const [monthlyRes, pnlRes] = await Promise.all([
    supabase.rpc("dash_metrics_monthly" as never, { p_org: orgId, p_from: from, p_to: to } as never),
    supabase.rpc("pnl_monthly" as never, { p_org: orgId, p_from: from, p_to: to } as never),
  ]);

  type MonthlyRow = { month: string; gross_revenue: number; refunds: number; expense_total: number };
  type PnlCatRow = { month: string; category: string; label: string; amount: number };

  const monthly: MonthlyRow[] = (monthlyRes.data as MonthlyRow[]) ?? [];
  const catRows: PnlCatRow[] = (pnlRes.data as PnlCatRow[]) ?? [];

  // Revenue / refunds keyed by month.
  const gross = emptyValues();
  const refunds = emptyValues();
  for (const r of monthly) {
    const k = monthKeyFromDate(r.month);
    gross[k] = Number(r.gross_revenue) || 0;
    refunds[k] = Number(r.refunds) || 0;
  }

  // Fees + expense categories from the P&L rollup.
  const fees = emptyValues();
  // slug → { label, values }
  const cats = new Map<string, { label: string; values: Record<string, number> }>();
  for (const c of catRows) {
    const k = monthKeyFromDate(c.month);
    const amt = Number(c.amount) || 0;
    if (c.category === "__pg_fees__") {
      fees[k] = (fees[k] ?? 0) + amt;
      continue;
    }
    let entry = cats.get(c.category);
    if (!entry) {
      entry = { label: c.label || c.category, values: emptyValues() };
      cats.set(c.category, entry);
    }
    entry.values[k] = (entry.values[k] ?? 0) + amt;
  }

  // Derived series.
  const netRevenue = emptyValues();
  const grossProfit = emptyValues();
  const totalOpex = emptyValues();
  const netProfit = emptyValues();
  const margin = emptyValues();

  const allKeys = new Set<string>([
    ...Object.keys(gross), ...Object.keys(refunds), ...Object.keys(fees),
    ...[...cats.values()].flatMap((c) => Object.keys(c.values)),
  ]);
  for (const k of allKeys) {
    const g = gross[k] ?? 0;
    const rf = refunds[k] ?? 0;
    const fe = fees[k] ?? 0;
    const opex = [...cats.values()].reduce((a, c) => a + (c.values[k] ?? 0), 0);
    const nr = g - rf;
    const gp = nr - fe;
    const np = gp - opex;
    netRevenue[k] = nr;
    grossProfit[k] = gp;
    totalOpex[k] = opex;
    netProfit[k] = np;
    margin[k] = nr !== 0 ? (np / nr) * 100 : 0;
  }

  // Order expense categories by descending total over the displayed FY.
  const catList = [...cats.entries()]
    .map(([slug, c]) => ({ slug, label: c.label, values: c.values, total: sumDisplayed(c.values, displayedKeys) }))
    .sort((a, b) => b.total - a.total);

  const rows: PnlRow[] = [];
  const push = (id: string, label: string, kind: PnlRowKind, values: Record<string, number>, drill?: string) =>
    rows.push({ id, label, kind, values, total: sumDisplayed(values, displayedKeys), drill });

  push("gross_revenue", "Gross Revenue", "revenue", gross, "revenue");
  push("refunds", "Refunds", "deduction", refunds, "refunds");
  push("net_revenue", "Net Revenue", "subtotal", netRevenue);
  push("pg_fees", "Payment Gateway Fees", "deduction", fees, "__pg_fees__");
  push("gross_profit", "Gross Profit", "subtotal", grossProfit);
  for (const c of catList) push(`exp_${c.slug}`, c.label, "expense", c.values, c.slug);
  push("total_opex", "Total Operating Expenses", "subtotal", totalOpex);
  push("net_profit", "Net Profit / (Loss)", "total", netProfit);
  push("margin", "Net Margin %", "margin", margin);

  const hasData = monthly.length > 0 || catRows.length > 0;

  return {
    fyStart,
    fyLabel: fyLabel(fyStart),
    months,
    rows,
    hasData,
    preview: false,
  };
}

// ─── Sample P&L (shown before any source is connected) ────────────────────────
export function samplePnl(fyStart: number): PnlData {
  const months = fyMonths(fyStart);
  const keys = months.map((m) => m.key);
  const seedRev = [820000, 860000, 910000, 880000, 940000, 1010000, 990000, 1060000, 1120000, 1090000, 1180000, 1250000];
  const mkVals = (fn: (i: number) => number) => Object.fromEntries(keys.map((k, i) => [k, Math.round(fn(i))]));

  const gross = mkVals((i) => seedRev[i]);
  const refunds = mkVals((i) => seedRev[i] * 0.02);
  const fees = mkVals((i) => seedRev[i] * 0.025);
  const catDefs: [string, number][] = [
    ["People", 0.34], ["Marketing", 0.18], ["Infrastructure", 0.09], ["Software", 0.05], ["Operations", 0.04],
  ];
  const cats = catDefs.map(([label, frac]) => ({ label, slug: label.toLowerCase(), values: mkVals((i) => seedRev[i] * frac) }));

  const derive = (fn: (i: number) => number) => mkVals(fn);
  const netRevenue = derive((i) => gross[keys[i]] - refunds[keys[i]]);
  const grossProfit = derive((i) => netRevenue[keys[i]] - fees[keys[i]]);
  const totalOpex = derive((i) => cats.reduce((a, c) => a + c.values[keys[i]], 0));
  const netProfit = derive((i) => grossProfit[keys[i]] - totalOpex[keys[i]]);
  const margin = Object.fromEntries(keys.map((k) => [k, netRevenue[k] !== 0 ? (netProfit[k] / netRevenue[k]) * 100 : 0]));

  const sum = (v: Record<string, number>) => keys.reduce((a, k) => a + (v[k] ?? 0), 0);
  const rows: PnlRow[] = [
    { id: "gross_revenue", label: "Gross Revenue", kind: "revenue", values: gross, total: sum(gross) },
    { id: "refunds", label: "Refunds", kind: "deduction", values: refunds, total: sum(refunds) },
    { id: "net_revenue", label: "Net Revenue", kind: "subtotal", values: netRevenue, total: sum(netRevenue) },
    { id: "pg_fees", label: "Payment Gateway Fees", kind: "deduction", values: fees, total: sum(fees) },
    { id: "gross_profit", label: "Gross Profit", kind: "subtotal", values: grossProfit, total: sum(grossProfit) },
    ...cats.map((c) => ({ id: `exp_${c.slug}`, label: c.label, kind: "expense" as const, values: c.values, total: sum(c.values) })),
    { id: "total_opex", label: "Total Operating Expenses", kind: "subtotal", values: totalOpex, total: sum(totalOpex) },
    { id: "net_profit", label: "Net Profit / (Loss)", kind: "total", values: netProfit, total: sum(netProfit) },
    { id: "margin", label: "Net Margin %", kind: "margin", values: margin, total: netRevenue && sum(netRevenue) !== 0 ? (sum(netProfit) / sum(netRevenue)) * 100 : 0 },
  ];

  return { fyStart, fyLabel: fyLabel(fyStart), months, rows, hasData: true, preview: true };
}
