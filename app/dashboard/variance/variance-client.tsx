"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles, Zap, ChevronDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useNavProgress } from "@/components/dashboard/nav-progress";
import { PageHeader } from "@/components/dashboard/page-header";
import type { VarianceData, VarianceRow } from "@/lib/variance";

type View = "actual" | "forecast" | "var_abs" | "var_pct";
const money = (n: number) => formatCurrency(Math.abs(n), "INR", true);
const moneyFull = (n: number) => formatCurrency(n, "INR", false);
const sumKeys = (m: Record<string, number>, keys: string[]) => keys.reduce((a, k) => a + (m[k] ?? 0), 0);
const goodWhenUp = (r: VarianceRow) => r.kind === "revenue" || r.kind === "subtotal" || r.kind === "total" || r.kind === "cm" || r.kind === "margin";

export function VarianceClient({ data, years }: { data: VarianceData; years: number[] }) {
  const { navigate } = useNavProgress();
  const [view, setView] = React.useState<View>("actual");
  const [fyOpen, setFyOpen] = React.useState(false);
  const [tip, setTip] = React.useState<{ text: string; x: number; y: number } | null>(null);
  const setTipAt = (text: string | null, x = 0, y = 0) => setTip(text ? { text, x, y } : null);

  const marginRowRef = React.useRef<HTMLTableRowElement>(null);
  const [marginH, setMarginH] = React.useState(0);
  React.useLayoutEffect(() => { if (marginRowRef.current) setMarginH(marginRowRef.current.offsetHeight); }, [data, view]);

  const rowsById = React.useMemo(() => Object.fromEntries(data.rows.map((r) => [r.id, r])), [data.rows]);
  const elapsed = new Set(data.elapsedKeys);

  type Col = { key: string; label: string; monthKeys: string[]; hasActual: boolean };
  const cols: Col[] = [
    ...data.months.map((m) => ({ key: m.key, label: m.label, monthKeys: [m.key], hasActual: elapsed.has(m.key) })),
    { key: "__ytd__", label: "YTD", monthKeys: data.elapsedKeys, hasActual: data.elapsedKeys.length > 0 },
  ];

  const aggA = (row: VarianceRow | undefined, c: Col) => (row ? sumKeys(row.actual, c.monthKeys) : 0);
  const aggP = (row: VarianceRow | undefined, c: Col) => (row ? sumKeys(row.plan, c.monthKeys) : 0);
  const pct = (num: number, base: number) => (base ? (num / base) * 100 : null);
  // margin % (actual/plan) for margin & cm rows, as % of net revenue
  const marginPct = (row: VarianceRow, c: Col, which: "a" | "p"): number | null => {
    if (!row.pctBaseId) return null;
    const baseRow = rowsById[row.pctBaseId];
    const numRow = rowsById[row.numeratorId ?? row.id];
    const base = which === "a" ? aggA(baseRow, c) : aggP(baseRow, c);
    const num = which === "a" ? aggA(numRow, c) : aggP(numRow, c);
    return pct(num, base);
  };

  const cellText = (row: VarianceRow, v: number) => {
    if (v === 0) return "–";
    if (row.kind === "deduction" || row.kind === "expense") return v > 0 ? `−${money(v)}` : `+${money(-v)}`;
    return v < 0 ? `−${money(v)}` : money(v);
  };

  const exportHref = (fmt: string) => `/api/pnl/export?mode=monthly&fy=${data.fyStart}&format=${fmt}`;

  return (
    <div className="space-y-3 max-w-[1400px]">
      <PageHeader title="Variance" subtitle={`Forecast vs actuals · ${data.periodLabel} · plan = trend from FY start`}>
        <div className="relative">
          <button onClick={() => setFyOpen((o) => !o)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12.5px] font-medium hover:bg-muted">
            FY {data.fyStart}-{String((data.fyStart + 1) % 100).padStart(2, "0")} <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {fyOpen && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setFyOpen(false)} />
              <div className="absolute right-0 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-[91] py-1">
                {years.map((y) => (
                  <button key={y} onClick={() => { setFyOpen(false); navigate(`/dashboard/variance?fy=${y}`); }}
                    className={cn("w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-muted", y === data.fyStart ? "text-primary font-semibold" : "text-foreground")}>
                    FY {y}-{String((y + 1) % 100).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {([["actual", "Actual"], ["forecast", "Forecast"], ["var_abs", "Variance ₹"], ["var_pct", "Variance %"]] as [View, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setView(m)} className={cn("h-8 px-2.5 text-[12px] font-medium transition-colors", view === m ? "bg-sidebar text-white" : "text-muted-foreground hover:bg-muted")}>{label}</button>
          ))}
        </div>
        {!data.preview && (
          <a href={exportHref("xlsx")} className="inline-flex items-center gap-1 text-[12px] h-8 px-2.5 rounded-lg border border-border hover:bg-muted">Actuals ↓</a>
        )}
      </PageHeader>

      {data.preview && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-[12.5px] text-foreground/80 flex-1 min-w-0"><span className="font-semibold text-foreground">Preview — sample data.</span> Connect a source to compare your real actuals to plan.</p>
          <Link href="/dashboard/connectors" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0"><Zap className="h-3.5 w-3.5" /> Connect</Link>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-215px)]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="sticky left-0 top-0 z-[6] bg-sidebar text-left font-semibold text-white px-3 py-2.5 min-w-[240px] border-r border-white/10">Particulars</th>
                {cols.map((c) => (
                  <th key={c.key} className={cn("sticky top-0 z-[4] bg-sidebar text-right font-semibold text-white/80 px-3 py-2.5 whitespace-nowrap min-w-[96px] border-l border-white/10", c.key === "__ytd__" && "font-bold text-white")}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const strong = row.emphasis === "strong";
                const isCm = row.emphasis === "cm";
                const isTotal = row.kind === "total";
                const isMargin = row.kind === "margin";
                const isNetProfit = row.id === "net_profit";
                const isNetMargin = row.id === "net_margin";
                const isFooter = isNetProfit || isNetMargin;
                const footerBottom = isNetMargin ? 0 : marginH;
                return (
                  <React.Fragment key={row.id}>
                    {row.section && (
                      <tr><td colSpan={cols.length + 1} className="sticky left-0 bg-card px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{row.section}</td></tr>
                    )}
                    <tr ref={isNetMargin ? marginRowRef : undefined}
                      className={cn("border-b border-border/50",
                        !isFooter && strong && "bg-muted/40", !isFooter && isCm && "bg-primary/[0.055]", !isFooter && isTotal && "bg-primary/[0.09]",
                        isNetProfit && "border-t-2 border-border")}>
                      <td style={isFooter ? { bottom: footerBottom } : undefined}
                        className={cn("sticky left-0 px-3 py-2 whitespace-nowrap border-r border-border",
                          isFooter ? cn("z-[4] bg-muted text-foreground", isNetProfit && "font-bold")
                            : cn("z-[1]", (strong || isCm || isTotal) ? "bg-muted" : "bg-card",
                                strong ? "font-bold text-foreground" : isCm ? "font-semibold text-foreground" : "text-foreground/90",
                                isTotal && "font-bold", row.kind === "expense" && "pl-6 text-muted-foreground font-normal"))}>
                        {row.label}
                      </td>
                      {cols.map((c) => {
                        // margin rows compare percentage points; everything else compares ₹
                        const aA = isMargin || isCm ? null : aggA(row, c);
                        const aP = isMargin || isCm ? null : aggP(row, c);
                        const mA = isMargin ? marginPct(row, c, "a") : null;
                        const mP = isMargin ? marginPct(row, c, "p") : null;

                        // choose primary value + variance by view
                        let display: React.ReactNode = "–";
                        let varSub: { text: string; up: boolean; good: boolean } | null = null;
                        let full = "";

                        if (isMargin) {
                          const a = c.hasActual ? mA : null, p = mP;
                          if (view === "forecast") { display = p == null ? "–" : `${p.toFixed(1)}%`; full = display as string; }
                          else if (view === "actual") {
                            display = a == null ? "–" : <span className={a < 0 ? "text-destructive" : "text-foreground"}>{a.toFixed(1)}%</span>;
                            full = a == null ? "—" : `${a.toFixed(1)}%`;
                            if (a != null && p != null) { const d = a - p; varSub = { text: `${d >= 0 ? "+" : ""}${d.toFixed(1)} pp`, up: d >= 0, good: (d >= 0) === goodWhenUp(row) }; }
                          } else { // variance (pp)
                            const d = a != null && p != null ? a - p : null;
                            display = d == null ? "–" : <span className={(d >= 0) === goodWhenUp(row) ? "text-success" : "text-destructive"}>{d >= 0 ? "+" : ""}{d.toFixed(1)} pp</span>;
                            full = d == null ? "—" : `${d.toFixed(1)} pp`;
                          }
                        } else {
                          const a = c.hasActual ? (aA ?? 0) : null, p = aP ?? 0;
                          const v = a != null ? a - p : null;
                          const vp = a != null && p !== 0 ? ((a - p) / Math.abs(p)) * 100 : null;
                          const totalColor = (n: number) => (isTotal ? <span className={n < 0 ? "text-destructive" : "text-success"}>{cellText(row, n)}</span> : cellText(row, n));
                          if (view === "forecast") { display = totalColor(p); full = moneyFull(p); }
                          else if (view === "actual") {
                            display = a == null ? "–" : totalColor(a); full = a == null ? "—" : moneyFull(a);
                            if (vp != null) varSub = { text: `${Math.abs(vp).toFixed(0)}%`, up: (v ?? 0) >= 0, good: ((v ?? 0) >= 0) === goodWhenUp(row) };
                          } else if (view === "var_abs") {
                            display = v == null ? "–" : <span className={(v >= 0) === goodWhenUp(row) ? "text-success" : "text-destructive"}>{v >= 0 ? "+" : "−"}{money(v)}</span>;
                            full = v == null ? "—" : moneyFull(v);
                          } else { // var_pct
                            display = vp == null ? "–" : <span className={(vp >= 0) === goodWhenUp(row) ? "text-success" : "text-destructive"}>{vp >= 0 ? "+" : ""}{vp.toFixed(0)}%</span>;
                            full = vp == null ? "—" : `${vp.toFixed(1)}%`;
                          }
                        }

                        return (
                          <td key={c.key}
                            style={isFooter ? { bottom: footerBottom } : undefined}
                            className={cn("text-right px-3 py-2 num align-top border-l border-border/60",
                              isFooter ? "sticky z-[3] bg-muted" : c.key === "__ytd__" && "bg-muted/30")}
                            onMouseEnter={(e) => full && full !== "—" && setTipAt(full, e.clientX, e.clientY)}
                            onMouseMove={(e) => full && full !== "—" && setTipAt(full, e.clientX, e.clientY)}
                            onMouseLeave={() => setTipAt(null)}>
                            <span className={cn("inline-block leading-tight",
                              isTotal && "font-bold",
                              (strong || isCm) && !isTotal && "font-semibold")}>{display}</span>
                            {varSub && (
                              <span className={cn("flex items-center justify-end gap-0.5 text-[10px] mt-0.5", varSub.good ? "text-success" : "text-destructive")}>
                                {varSub.up ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}{varSub.text}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground px-1">
        <span className="font-medium text-foreground/70">Plan</span> is each line seeded from its {data.periodLabel} first month and grown at its recent trend. Actuals come from your live data; future months show plan only.
        Green = favourable vs plan (more revenue / less cost), red = unfavourable. YTD covers elapsed months only.
      </p>

      {tip && <div className="fixed z-[200] pointer-events-none px-2 py-1 rounded-md bg-foreground text-background text-[11px] font-medium num shadow-lg" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>}
    </div>
  );
}
