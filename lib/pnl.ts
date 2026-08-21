import { createServiceClient } from "@/lib/supabase/server";

// ─── Types ──────────────────────────────────────────────────────────────────
export type PnlMode = "monthly" | "annual" | "custom";
export type PnlRowKind = "revenue" | "deduction" | "subtotal" | "expense" | "cm" | "total" | "margin";

export interface PnlRow {
  id: string;
  label: string;
  kind: PnlRowKind;
  emphasis?: "strong" | "cm";     // strong = anchor band; cm = contribution-margin tint
  /** ₹ amount per month ('YYYY-MM') across the fetched window. Missing = 0. */
  monthly: Record<string, number>;
  drill?: string;                  // slice key for cell drill-down
  pctBaseId?: string;              // if set, render a % = numerator / base
  numeratorId?: string;            // numerator row for the %, defaults to self
  section?: string;                // faint group heading rendered above this row
}

export interface PnlColumn {
  key: string;                     // 'YYYY-MM' (month/custom) or 'FYyyyy' (annual)
  label: string;
  monthKeys: string[];             // months this column aggregates
}

export interface PnlData {
  mode: PnlMode;
  periodLabel: string;
  fyStart: number;                 // selected FY (monthly/annual anchor)
  from?: string;                   // custom range echo
  to?: string;
  columns: PnlColumn[];
  rows: PnlRow[];
  hasData: boolean;
  preview: boolean;
}

// ─── Contribution-margin config (SaaS default; edit here to remap tiers) ──────
// Each tier subtracts its cost bucket from the tier above. '__pg_fees__' is the
// metadata.fee line; the rest are ledger_categories slugs.
export const CM_CONFIG: { id: string; label: string; cats: string[] }[] = [
  { id: "cm1", label: "CM1 · Gross Margin", cats: ["__pg_fees__", "ai_model", "cloud_infra", "technical_expense"] },
  { id: "cm2", label: "CM2 · Post-Marketing", cats: ["marketing"] },
  { id: "cm3", label: "CM3 · Post-People", cats: ["payroll", "contractors", "professional"] },
];
const CM_CAT_ORDER = CM_CONFIG.flatMap((t) => t.cats).filter((c) => c !== "__pg_fees__");

// ─── Month / FY helpers ────────────────────────────────────────────────────────
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fyStartForDate(d: Date): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return m >= 3 ? y : y - 1;
}
export function fyLabel(fyStart: number): string {
  return `FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
}
const mk = (year: number, month1: number) => `${year}-${String(month1).padStart(2, "0")}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${String(y).slice(2)}`;
};
function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return mk(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
function monthSpan(fromKey: string, toKey: string): string[] {
  const out: string[] = [];
  let cur = fromKey;
  for (let i = 0; i < 480 && cur <= toKey; i++) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
}
function fyMonthKeys(fyStart: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month0 = (3 + i) % 12;
    const year = 3 + i < 12 ? fyStart : fyStart + 1;
    out.push(mk(year, month0 + 1));
  }
  return out;
}
function lastDayIso(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}
const monthKeyFromDate = (iso: string): string => iso.slice(0, 7);

// ─── Column builders per mode ──────────────────────────────────────────────────
function buildColumns(params: PnlParams): { columns: PnlColumn[]; periodLabel: string } {
  if (params.mode === "annual") {
    const end = params.fyStart;
    const n = params.years ?? 5;
    const cols: PnlColumn[] = [];
    for (let fy = end - n + 1; fy <= end; fy++) {
      cols.push({ key: `FY${fy}`, label: `FY ${fy}-${String((fy + 1) % 100).padStart(2, "0")}`, monthKeys: fyMonthKeys(fy) });
    }
    return { columns: cols, periodLabel: `${cols[0].label} → ${cols[cols.length - 1].label}` };
  }
  if (params.mode === "custom" && params.from && params.to) {
    const fromKey = params.from.slice(0, 7);
    const toKey = params.to.slice(0, 7);
    let keys = monthSpan(fromKey, toKey);
    if (keys.length > 36) keys = keys.slice(-36); // guard runaway width
    const cols = keys.map((k) => ({ key: k, label: monthLabel(k), monthKeys: [k] }));
    return { columns: cols, periodLabel: `${monthLabel(fromKey)} – ${monthLabel(toKey)}` };
  }
  // monthly (default)
  const keys = fyMonthKeys(params.fyStart);
  return { columns: keys.map((k) => ({ key: k, label: monthLabel(k), monthKeys: [k] })), periodLabel: fyLabel(params.fyStart) };
}

export interface PnlParams {
  mode: PnlMode;
  fyStart: number;
  from?: string;
  to?: string;
  years?: number;
}

// aggregate a row's monthly series over a set of month keys
export function aggregate(row: PnlRow | undefined, monthKeys: string[]): number {
  if (!row) return 0;
  return monthKeys.reduce((a, k) => a + (row.monthly[k] ?? 0), 0);
}

// ─── Main loader ──────────────────────────────────────────────────────────────
export async function getPnl(orgId: string, params: PnlParams): Promise<PnlData> {
  const { columns, periodLabel } = buildColumns(params);
  const allKeys = columns.flatMap((c) => c.monthKeys);
  const minKey = allKeys.reduce((a, b) => (a < b ? a : b));
  const maxKey = allKeys.reduce((a, b) => (a > b ? a : b));
  const from = `${addMonths(minKey, -12)}-01`;   // extra year back for YoY/MoM bases
  const to = lastDayIso(maxKey);

  const supabase = await createServiceClient();
  const [monthlyRes, pnlRes] = await Promise.all([
    supabase.rpc("dash_metrics_monthly" as never, { p_org: orgId, p_from: from, p_to: to } as never),
    supabase.rpc("pnl_monthly" as never, { p_org: orgId, p_from: from, p_to: to } as never),
  ]);

  type MonthlyRow = { month: string; gross_revenue: number; refunds: number };
  type PnlCatRow = { month: string; category: string; label: string; amount: number };
  const monthly: MonthlyRow[] = (monthlyRes.data as MonthlyRow[]) ?? [];
  const catRows: PnlCatRow[] = (pnlRes.data as PnlCatRow[]) ?? [];

  const gross: Record<string, number> = {};
  const refunds: Record<string, number> = {};
  for (const r of monthly) {
    const k = monthKeyFromDate(r.month);
    gross[k] = Number(r.gross_revenue) || 0;
    refunds[k] = Number(r.refunds) || 0;
  }

  const fees: Record<string, number> = {};
  const cats = new Map<string, { label: string; values: Record<string, number> }>();
  for (const c of catRows) {
    const k = monthKeyFromDate(c.month);
    const amt = Number(c.amount) || 0;
    if (c.category === "__pg_fees__") { fees[k] = (fees[k] ?? 0) + amt; continue; }
    let e = cats.get(c.category);
    if (!e) { e = { label: c.label || c.category, values: {} }; cats.set(c.category, e); }
    e.values[k] = (e.values[k] ?? 0) + amt;
  }

  const windowKeys = new Set<string>([
    ...Object.keys(gross), ...Object.keys(refunds), ...Object.keys(fees),
    ...[...cats.values()].flatMap((c) => Object.keys(c.values)),
  ]);
  const catVal = (slug: string, k: string) => (slug === "__pg_fees__" ? (fees[k] ?? 0) : (cats.get(slug)?.values[k] ?? 0));

  // Derived monthly series.
  const netRevenue: Record<string, number> = {};
  const totalOpex: Record<string, number> = {};
  const netProfit: Record<string, number> = {};
  const cm: Record<string, Record<string, number>> = Object.fromEntries(CM_CONFIG.map((t) => [t.id, {}]));
  for (const k of windowKeys) {
    const g = gross[k] ?? 0, rf = refunds[k] ?? 0;
    const nr = g - rf;
    netRevenue[k] = nr;
    const opex = (fees[k] ?? 0) + [...cats.values()].reduce((a, c) => a + (c.values[k] ?? 0), 0);
    totalOpex[k] = opex;
    netProfit[k] = nr - opex;
    let running = nr;
    for (const t of CM_CONFIG) {
      running -= t.cats.reduce((a, slug) => a + catVal(slug, k), 0);
      cm[t.id][k] = running;
    }
  }

  const present = (slug: string) => [...windowKeys].some((k) => catVal(slug, k) !== 0);
  const rows: PnlRow[] = [];
  const add = (r: PnlRow) => rows.push(r);
  const catRow = (slug: string, section?: string): PnlRow | null => {
    if (slug !== "__pg_fees__" && !cats.has(slug)) return null;
    if (!present(slug)) return null;
    const label = slug === "__pg_fees__" ? "Payment Gateway Fees" : (cats.get(slug)?.label ?? slug);
    const monthlyVals = slug === "__pg_fees__" ? fees : (cats.get(slug)?.values ?? {});
    return { id: `exp_${slug}`, label, kind: slug === "__pg_fees__" ? "deduction" : "expense", monthly: monthlyVals, drill: slug, section };
  };

  add({ id: "gross_revenue", label: "Gross Revenue", kind: "revenue", emphasis: "strong", monthly: gross, drill: "revenue" });
  add({ id: "refunds", label: "Refunds", kind: "deduction", monthly: refunds, drill: "refunds" });
  add({ id: "net_revenue", label: "Net Revenue", kind: "subtotal", emphasis: "strong", monthly: netRevenue });

  // CM1 bucket (Cost of Revenue): fees + cogs categories, then CM1
  let firstCogs = true;
  const cogsSlugs = ["__pg_fees__", ...CM_CONFIG[0].cats.filter((c) => c !== "__pg_fees__")];
  for (const slug of cogsSlugs) {
    const r = catRow(slug, firstCogs ? "Cost of Revenue" : undefined);
    if (r) { add(r); firstCogs = false; }
  }
  add({ id: "cm1", label: CM_CONFIG[0].label, kind: "cm", emphasis: "cm", monthly: cm.cm1, pctBaseId: "net_revenue" });

  // CM2 bucket (Sales & Marketing)
  let firstSm = true;
  for (const slug of CM_CONFIG[1].cats) {
    const r = catRow(slug, firstSm ? "Sales & Marketing" : undefined);
    if (r) { add(r); firstSm = false; }
  }
  add({ id: "cm2", label: CM_CONFIG[1].label, kind: "cm", emphasis: "cm", monthly: cm.cm2, pctBaseId: "net_revenue" });

  // CM3 bucket (People)
  let firstP = true;
  for (const slug of CM_CONFIG[2].cats) {
    const r = catRow(slug, firstP ? "People" : undefined);
    if (r) { add(r); firstP = false; }
  }
  add({ id: "cm3", label: CM_CONFIG[2].label, kind: "cm", emphasis: "cm", monthly: cm.cm3, pctBaseId: "net_revenue" });

  // Remaining opex categories (anything not in a CM bucket), largest first.
  const bucketed = new Set(["__pg_fees__", ...CM_CAT_ORDER]);
  const others = [...cats.entries()]
    .filter(([slug]) => !bucketed.has(slug) && present(slug))
    .map(([slug, c]) => ({ slug, total: [...windowKeys].reduce((a, k) => a + (c.values[k] ?? 0), 0) }))
    .sort((a, b) => b.total - a.total);
  let firstOther = true;
  for (const o of others) {
    const r = catRow(o.slug, firstOther ? "Other Operating" : undefined);
    if (r) { add(r); firstOther = false; }
  }

  add({ id: "total_opex", label: "Total Operating Expenses", kind: "subtotal", emphasis: "strong", monthly: totalOpex });
  add({ id: "net_profit", label: "Net Profit / (Loss)", kind: "total", emphasis: "strong", monthly: netProfit });
  add({ id: "net_margin", label: "Net Margin %", kind: "margin", monthly: {}, pctBaseId: "net_revenue", numeratorId: "net_profit" });

  return {
    mode: params.mode,
    periodLabel,
    fyStart: params.fyStart,
    from: params.from,
    to: params.to,
    columns,
    rows,
    hasData: monthly.length > 0 || catRows.length > 0,
    preview: false,
  };
}

// ─── Sample P&L (shown before any source is connected) ────────────────────────
export function samplePnl(params: PnlParams): PnlData {
  const { columns, periodLabel } = buildColumns(params);
  const keys = [...new Set(columns.flatMap((c) => c.monthKeys))].sort();
  const seed = (i: number, base: number, drift: number) => Math.round(base * (1 + drift * i));
  const mkS = (base: number, drift: number) => Object.fromEntries(keys.map((k, i) => [k, seed(i, base, drift)]));

  const gross = mkS(9000000, 0.03);
  const refunds = Object.fromEntries(keys.map((k) => [k, Math.round((gross[k] ?? 0) * 0.02)]));
  const fees = Object.fromEntries(keys.map((k) => [k, Math.round((gross[k] ?? 0) * 0.03)]));
  const catDefs: [string, string, number][] = [
    ["ai_model", "AI Model", 0.22], ["cloud_infra", "Cloud & Infrastructure", 0.04], ["technical_expense", "Technical Expense", 0.02],
    ["marketing", "Marketing & Advertising", 0.12], ["payroll", "Payroll", 0.14], ["contractors", "Contractors & Freelancers", 0.03],
    ["professional", "Professional Services", 0.03], ["travel", "Travel", 0.02], ["software", "Software & SaaS", 0.02],
  ];
  const cats = new Map(catDefs.map(([slug, label, frac]) => [slug, { label, values: Object.fromEntries(keys.map((k) => [k, Math.round((gross[k] ?? 0) * frac)])) }]));

  const catVal = (slug: string, k: string) => (slug === "__pg_fees__" ? (fees[k] ?? 0) : (cats.get(slug)?.values[k] ?? 0));
  const netRevenue: Record<string, number> = {}, totalOpex: Record<string, number> = {}, netProfit: Record<string, number> = {};
  const cm: Record<string, Record<string, number>> = Object.fromEntries(CM_CONFIG.map((t) => [t.id, {}]));
  for (const k of keys) {
    const nr = (gross[k] ?? 0) - (refunds[k] ?? 0);
    netRevenue[k] = nr;
    const opex = (fees[k] ?? 0) + [...cats.values()].reduce((a, c) => a + (c.values[k] ?? 0), 0);
    totalOpex[k] = opex; netProfit[k] = nr - opex;
    let running = nr;
    for (const t of CM_CONFIG) { running -= t.cats.reduce((a, s) => a + catVal(s, k), 0); cm[t.id][k] = running; }
  }

  const rows: PnlRow[] = [];
  rows.push({ id: "gross_revenue", label: "Gross Revenue", kind: "revenue", emphasis: "strong", monthly: gross, drill: "revenue" });
  rows.push({ id: "refunds", label: "Refunds", kind: "deduction", monthly: refunds, drill: "refunds" });
  rows.push({ id: "net_revenue", label: "Net Revenue", kind: "subtotal", emphasis: "strong", monthly: netRevenue });
  const sampleCat = (slug: string, section?: string): PnlRow => ({
    id: `exp_${slug}`, label: slug === "__pg_fees__" ? "Payment Gateway Fees" : (cats.get(slug)?.label ?? slug),
    kind: slug === "__pg_fees__" ? "deduction" : "expense", monthly: slug === "__pg_fees__" ? fees : (cats.get(slug)?.values ?? {}), drill: slug, section,
  });
  rows.push(sampleCat("__pg_fees__", "Cost of Revenue"), sampleCat("ai_model"), sampleCat("cloud_infra"), sampleCat("technical_expense"));
  rows.push({ id: "cm1", label: CM_CONFIG[0].label, kind: "cm", emphasis: "cm", monthly: cm.cm1, pctBaseId: "net_revenue" });
  rows.push(sampleCat("marketing", "Sales & Marketing"));
  rows.push({ id: "cm2", label: CM_CONFIG[1].label, kind: "cm", emphasis: "cm", monthly: cm.cm2, pctBaseId: "net_revenue" });
  rows.push(sampleCat("payroll", "People"), sampleCat("contractors"), sampleCat("professional"));
  rows.push({ id: "cm3", label: CM_CONFIG[2].label, kind: "cm", emphasis: "cm", monthly: cm.cm3, pctBaseId: "net_revenue" });
  rows.push(sampleCat("travel", "Other Operating"), sampleCat("software"));
  rows.push({ id: "total_opex", label: "Total Operating Expenses", kind: "subtotal", emphasis: "strong", monthly: totalOpex });
  rows.push({ id: "net_profit", label: "Net Profit / (Loss)", kind: "total", emphasis: "strong", monthly: netProfit });
  rows.push({ id: "net_margin", label: "Net Margin %", kind: "margin", monthly: {}, pctBaseId: "net_revenue", numeratorId: "net_profit" });

  return { mode: params.mode, periodLabel, fyStart: params.fyStart, from: params.from, to: params.to, columns, rows, hasData: true, preview: true };
}
