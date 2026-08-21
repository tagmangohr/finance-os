"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles, Zap, RotateCcw } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/dashboard/page-header";
import { CM_CONFIG } from "@/lib/pnl-config";
import type { ForecastData, ForecastComponent } from "@/lib/forecast";

const money = (n: number) => formatCurrency(Math.abs(n), "INR", true);
const moneyFull = (n: number) => formatCurrency(n, "INR", false);

type RowKind = "revenue" | "deduction" | "subtotal" | "expense" | "cm" | "total" | "margin";
type Row =
  | { id: string; label: string; kind: RowKind; emphasis?: "strong" | "cm"; section?: string; comp: ForecastComponent }
  | { id: string; label: string; kind: RowKind; emphasis?: "strong" | "cm"; section?: string; comp?: undefined };

export function ForecastClient({ data, orgId }: { data: ForecastData; orgId: string }) {
  const bySlug = React.useMemo(() => Object.fromEntries(data.components.map((c) => [c.slug, c])), [data.components]);
  const [growth, setGrowth] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(data.components.map((c) => [c.slug, c.growthPct]))
  );
  const [saving, setSaving] = React.useState<string | null>(null);
  const [tip, setTip] = React.useState<{ text: string; x: number; y: number } | null>(null);
  const setTipAt = (text: string | null, x = 0, y = 0) => setTip(text ? { text, x, y } : null);

  // Persist a line's growth override (fires on blur). Preview data isn't saved.
  const saveGrowth = React.useCallback(async (slug: string, pct: number) => {
    if (data.preview) return;
    setSaving(slug);
    try {
      await fetch("/api/forecast/growth", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org: orgId, line_slug: slug, growth_pct: pct }),
      });
    } finally {
      setSaving(null);
    }
  }, [orgId, data.preview]);

  // Freeze Net Profit + Net Margin at the bottom; Net Profit pins just above Net
  // Margin, offset by its measured height.
  const marginRowRef = React.useRef<HTMLTableRowElement>(null);
  const [marginH, setMarginH] = React.useState(0);
  React.useLayoutEffect(() => {
    if (marginRowRef.current) setMarginH(marginRowRef.current.offsetHeight);
  }, [data, growth]);

  // Reset reverts every line to its trend default AND clears saved overrides.
  const reset = async () => {
    setGrowth(Object.fromEntries(data.components.map((c) => [c.slug, c.trendPct])));
    if (!data.preview) await fetch(`/api/forecast/growth?org=${orgId}`, { method: "DELETE" });
  };

  // projected value of a component at month index i (0-based)
  const proj = (slug: string, i: number): number => {
    const c = bySlug[slug];
    if (!c) return 0;
    const g = (growth[slug] ?? c.growthPct) / 100;
    return c.base * Math.pow(1 + g, i + 1);
  };
  const catSlugs = data.components.filter((c) => c.kind === "expense").map((c) => c.slug);
  const cmCats = new Set(CM_CONFIG.flatMap((t) => t.cats).filter((s) => s !== "__pg_fees__"));

  // Derived monthly value by row id at month i.
  const valueAt = (rowId: string, slug: string | undefined, i: number): number => {
    if (slug) return proj(slug, i);
    const gross = proj("__gross__", i), refunds = proj("__refunds__", i), fees = proj("__pg_fees__", i);
    const netRev = gross - refunds;
    const opexCats = catSlugs.reduce((a, s) => a + proj(s, i), 0);
    if (rowId === "net_rev") return netRev;
    if (rowId === "total_opex") return fees + opexCats;
    if (rowId === "net_profit") return netRev - (fees + opexCats);
    if (rowId.startsWith("cm")) {
      let running = netRev;
      for (const t of CM_CONFIG) {
        running -= t.cats.reduce((a, s) => a + proj(s, i), 0);
        if (t.id === rowId) return running;
      }
    }
    return 0;
  };
  const netRevAt = (i: number) => proj("__gross__", i) - proj("__refunds__", i);

  // Build the row list (mirrors the P&L layout).
  const rows: Row[] = [];
  const compRow = (slug: string, section?: string): Row | null => {
    const c = bySlug[slug];
    if (!c) return null;
    return { id: `comp_${slug}`, label: c.label, kind: c.kind === "expense" ? "expense" : c.kind, comp: c, section };
  };
  const pushComp = (slug: string, section?: string) => { const r = compRow(slug, section); if (r) rows.push(r); };

  if (bySlug["__gross__"]) rows.push({ ...(compRow("__gross__") as Row), emphasis: "strong" });
  pushComp("__refunds__");
  rows.push({ id: "net_rev", label: "Net Revenue", kind: "subtotal", emphasis: "strong" });
  pushComp("__pg_fees__", "Cost of Revenue");
  CM_CONFIG[0].cats.filter((s) => s !== "__pg_fees__").forEach((s) => pushComp(s));
  rows.push({ id: "cm1", label: CM_CONFIG[0].label, kind: "cm", emphasis: "cm" });
  CM_CONFIG[1].cats.forEach((s, idx) => pushComp(s, idx === 0 ? "Sales & Marketing" : undefined));
  rows.push({ id: "cm2", label: CM_CONFIG[1].label, kind: "cm", emphasis: "cm" });
  CM_CONFIG[2].cats.forEach((s, idx) => pushComp(s, idx === 0 ? "People" : undefined));
  rows.push({ id: "cm3", label: CM_CONFIG[2].label, kind: "cm", emphasis: "cm" });
  const others = catSlugs.filter((s) => !cmCats.has(s));
  others.forEach((s, idx) => pushComp(s, idx === 0 ? "Other Operating" : undefined));
  rows.push({ id: "total_opex", label: "Total Operating Expenses", kind: "subtotal", emphasis: "strong" });
  rows.push({ id: "net_profit", label: "Net Profit / (Loss)", kind: "total", emphasis: "strong" });
  rows.push({ id: "net_margin", label: "Net Margin %", kind: "margin" });

  const months = data.months;
  const cellText = (kind: RowKind, v: number) => {
    if (v === 0) return "–";
    if (kind === "deduction" || kind === "expense") return v > 0 ? `−${money(v)}` : `+${money(-v)}`;
    return v < 0 ? `−${money(v)}` : money(v);
  };

  return (
    <div className="space-y-3 max-w-[1400px]">
      <PageHeader title="Forecast" subtitle={`Projected P&L · from ${data.lastActualLabel} actuals · auto-seeded, editable`}>
        {saving && <span className="text-[11px] text-muted-foreground">Saving…</span>}
        <button onClick={reset} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] font-medium hover:bg-muted">
          <RotateCcw className="h-3.5 w-3.5" /> Reset growth
        </button>
      </PageHeader>

      {data.preview && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-[12.5px] text-foreground/80 flex-1 min-w-0"><span className="font-semibold text-foreground">Preview — sample data.</span> Connect a source to forecast from your real numbers.</p>
          <Link href="/dashboard/connectors" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0"><Zap className="h-3.5 w-3.5" /> Connect</Link>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-215px)]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="sticky left-0 top-0 z-[6] bg-sidebar text-left font-semibold text-white px-3 py-2.5 min-w-[240px] border-r border-white/10">Particulars</th>
                <th className="sticky top-0 z-[4] bg-sidebar text-right font-semibold text-white/80 px-3 py-2.5 whitespace-nowrap min-w-[92px] border-l border-white/10">Growth /mo</th>
                {months.map((m) => (
                  <th key={m.key} className="sticky top-0 z-[4] bg-sidebar text-right font-semibold text-white/80 px-3 py-2.5 whitespace-nowrap min-w-[92px] border-l border-white/10">{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
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
                      <tr><td colSpan={months.length + 2} className="sticky left-0 bg-card px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{row.section}</td></tr>
                    )}
                    <tr
                      ref={isNetMargin ? marginRowRef : undefined}
                      className={cn("border-b border-border/50",
                        !isFooter && strong && "bg-muted/40",
                        !isFooter && isCm && "bg-primary/[0.055]",
                        !isFooter && isTotal && "bg-primary/[0.09]",
                        isNetProfit && "border-t-2 border-border")}
                    >
                      <td
                        style={isFooter ? { bottom: footerBottom } : undefined}
                        className={cn(
                          // opaque so right-scrolled month values don't bleed through
                          "sticky left-0 px-3 py-2 whitespace-nowrap border-r border-border",
                          isFooter
                            ? cn("z-[4] bg-muted text-foreground", isNetProfit && "font-bold")
                            : cn(
                                "z-[1]",
                                (strong || isCm || isTotal) ? "bg-muted" : "bg-card",
                                strong ? "font-bold text-foreground" : isCm ? "font-semibold text-foreground" : "text-foreground/90",
                                isTotal && "font-bold",
                                row.kind === "expense" && "pl-6 text-muted-foreground font-normal"
                              )
                        )}
                      >{row.label}</td>

                      {/* editable growth */}
                      <td
                        style={isFooter ? { bottom: footerBottom } : undefined}
                        className={cn("text-right px-2 py-1.5 num border-l border-border/60", isFooter ? "sticky z-[3] bg-muted" : "bg-muted/10")}
                      >
                        {row.comp ? (
                          <div className="inline-flex items-center gap-0.5">
                            <input
                              type="number" step="0.5"
                              value={growth[row.comp.slug] ?? row.comp.growthPct}
                              onChange={(e) => setGrowth((g) => ({ ...g, [row.comp!.slug]: e.target.value === "" ? 0 : Number(e.target.value) }))}
                              onBlur={(e) => saveGrowth(row.comp!.slug, e.target.value === "" ? 0 : Number(e.target.value))}
                              className="w-14 text-right bg-transparent border border-border rounded px-1 py-0.5 text-[12px] focus:outline-none focus:border-primary"
                            />
                            <span className="text-muted-foreground text-[11px]">%</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>

                      {months.map((m, i) => {
                        const v = valueAt(row.id, row.comp?.slug, i);
                        const nr = netRevAt(i);
                        const pct = isMargin ? (nr ? (valueAt("net_profit", undefined, i) / nr) * 100 : null)
                          : isCm ? (nr ? (v / nr) * 100 : null) : null;
                        const full = isMargin ? (pct == null ? "—" : `${pct.toFixed(1)}%`) : moneyFull(v);
                        return (
                          <td key={m.key}
                            style={isFooter ? { bottom: footerBottom } : undefined}
                            className={cn("text-right px-3 py-2 num align-top border-l border-border/60", isFooter && "sticky z-[3] bg-muted")}
                            onMouseEnter={(e) => v !== 0 && setTipAt(full, e.clientX, e.clientY)}
                            onMouseMove={(e) => v !== 0 && setTipAt(full, e.clientX, e.clientY)}
                            onMouseLeave={() => setTipAt(null)}>
                            <span className={cn("inline-block leading-tight",
                              isTotal && (v < 0 ? "text-destructive font-bold" : "text-success font-bold"),
                              (strong || isCm) && !isTotal && "font-semibold")}>
                              {isMargin ? (pct == null ? "–" : <span className={pct < 0 ? "text-destructive" : "text-foreground"}>{pct.toFixed(1)}%</span>) : cellText(row.kind, v)}
                            </span>
                            {isCm && pct != null && <div className="text-[10px] text-primary/80 mt-0.5">{pct.toFixed(0)}% margin</div>}
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
        Each line is seeded from its trailing 3-month average and recent monthly growth, then compounded forward. Edit any <span className="font-medium text-foreground/70">Growth /mo</span> to model your own plan — subtotals, CM tiers and Net Profit recompute live. Projection is an estimate, not actuals.
      </p>

      {tip && <div className="fixed z-[200] pointer-events-none px-2 py-1 rounded-md bg-foreground text-background text-[11px] font-medium num shadow-lg" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>}
    </div>
  );
}
