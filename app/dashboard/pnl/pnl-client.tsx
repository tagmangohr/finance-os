"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { Download, Sparkles, Zap, X, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { sourceLabel } from "@/lib/finance/transaction-status";
import { useNavProgress } from "@/components/dashboard/nav-progress";
import { PageHeader } from "@/components/dashboard/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import type { PnlData, PnlRow, PnlColumn } from "@/lib/pnl";

type Mode = "abs" | "mom" | "yoy";

// ─── number helpers ───────────────────────────────────────────────────────────
const money = (n: number) => formatCurrency(Math.abs(n), "INR", true);
const moneyFull = (n: number) => formatCurrency(n, "INR", false);

function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const lastDayIso = (monthKey: string): string => {
  const [y, m] = monthKey.split("-").map(Number);
  return `${monthKey}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const sumKeys = (monthly: Record<string, number>, keys: string[]) => keys.reduce((a, k) => a + (monthly[k] ?? 0), 0);

// ─── exact-figure tooltip (single fixed element, avoids table clipping) ────────
const TipCtx = React.createContext<(text: string | null, x?: number, y?: number) => void>(() => {});

// ─── Drill drawer (consolidated by vendor/customer, expandable) ────────────────
type Group = { name: string; amount: number; txn_count: number };
type DrillTxn = { id: string; transaction_date: string; counterparty_name: string | null; amount: number; currency: string | null; source: string | null; status: string | null; fee: number | null };

const GATEWAY_KEYS = new Set(["revenue", "refunds", "__pg_fees__"]);
const groupDisplayName = (drillKey: string, name: string) => (GATEWAY_KEYS.has(drillKey) ? sourceLabel(name === "—" ? null : name) : name);

function GroupRow({ orgId, drillKey, from, to, g }: { orgId: string; drillKey: string; from: string; to: string; g: Group }) {
  const [open, setOpen] = React.useState(false);
  const [txns, setTxns] = React.useState<DrillTxn[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && txns == null) {
      setLoading(true);
      const q = new URLSearchParams({ org: orgId, key: drillKey, from, to, party: g.name });
      fetch(`/api/pnl/drill?${q}`)
        .then((r) => r.json())
        .then((d) => setTxns(d.rows ?? []))
        .catch(() => setTxns([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="border-b border-border/60">
      <button onClick={toggle} className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-muted/50 text-left">
        <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0", open && "rotate-90")} />
        <span className="text-[12.5px] text-foreground truncate flex-1">{groupDisplayName(drillKey, g.name)}</span>
        <span className="text-[10.5px] text-muted-foreground flex-shrink-0">{g.txn_count.toLocaleString("en-IN")}</span>
        <span className="num text-[12.5px] font-semibold text-foreground flex-shrink-0 w-[92px] text-right">{moneyFull(g.amount)}</span>
      </button>
      {open && (
        <div className="bg-muted/20">
          {loading && <div className="px-4 py-2 space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</div>}
          {txns?.map((t) => (
            <div key={t.id} className="pl-10 pr-4 py-1.5 flex items-center gap-3 border-t border-border/40">
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] text-muted-foreground">{formatDate(t.transaction_date)}{t.source ? ` · ${t.source}` : ""}{t.status ? ` · ${t.status}` : ""}</p>
              </div>
              <p className="num text-[11.5px] text-foreground flex-shrink-0">{t.fee != null ? moneyFull(t.fee) : formatCurrency(t.amount, t.currency || "INR", false)}</p>
            </div>
          ))}
          {txns && txns.length === 0 && !loading && <p className="pl-10 pr-4 py-2 text-[11px] text-muted-foreground">No transactions.</p>}
        </div>
      )}
    </div>
  );
}

function DrillDrawer({
  orgId, open, onClose, title, subtitle, drillKey, from, to, expectedTotal,
}: {
  orgId: string; open: boolean; onClose: () => void;
  title: string; subtitle: string; drillKey: string | null; from: string; to: string; expectedTotal: number;
}) {
  const [loading, setLoading] = React.useState(false);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !drillKey) return;
    let cancelled = false;
    setLoading(true); setErr(null); setGroups([]);
    const q = new URLSearchParams({ org: orgId, key: drillKey, from, to });
    fetch(`/api/pnl/drill/groups?${q}`)
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) { setGroups(d.groups ?? []); setHasMore(Boolean(d.hasMore)); } })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, drillKey, orgId, from, to]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[140]" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-card border-l border-border z-[141] shadow-2xl flex flex-col focus:outline-none">
          <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
            <div className="min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-foreground truncate">{title}</Dialog.Title>
              <p className="text-[12px] text-muted-foreground mt-0.5">{subtitle} · by {drillKey && GATEWAY_KEYS.has(drillKey) ? "gateway" : "vendor / customer"}</p>
            </div>
            <Dialog.Close className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center flex-shrink-0"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">{loading ? "Loading…" : `${groups.length}${hasMore ? "+" : ""} ${groups.length === 1 ? "party" : "parties"}`}</span>
            <span className="num text-[13px] font-semibold text-foreground" title="Total from the P&L rollup">{moneyFull(expectedTotal)}</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {err && <p className="p-4 text-[12px] text-destructive">{err}</p>}
            {loading && <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>}
            {!loading && !err && groups.length === 0 && <p className="p-6 text-center text-[12px] text-muted-foreground">Nothing in this slice.</p>}
            {!loading && drillKey && groups.map((g, i) => <GroupRow key={`${g.name}-${i}`} orgId={orgId} drillKey={drillKey} from={from} to={to} g={g} />)}
            {hasMore && <p className="p-4 text-center text-[11px] text-muted-foreground">Showing the top {groups.length} parties by value.</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export function PnlClient({ data, orgId, years }: { data: PnlData; orgId: string; years: number[] }) {
  const { navigate } = useNavProgress();
  const [change, setChange] = React.useState<Mode>("abs");
  const [fyOpen, setFyOpen] = React.useState(false);
  const [tip, setTip] = React.useState<{ text: string; x: number; y: number } | null>(null);
  const [drill, setDrill] = React.useState<{ title: string; subtitle: string; key: string; from: string; to: string; total: number } | null>(null);

  const setTipCb = React.useCallback((text: string | null, x?: number, y?: number) => {
    setTip(text ? { text, x: x ?? 0, y: y ?? 0 } : null);
  }, []);

  // Freeze the last two rows (Net Profit, Net Margin) at the bottom. Net Margin
  // pins to bottom:0; Net Profit pins just above it, offset by Net Margin's height.
  const marginRowRef = React.useRef<HTMLTableRowElement>(null);
  const [marginH, setMarginH] = React.useState(0);
  React.useLayoutEffect(() => {
    if (marginRowRef.current) setMarginH(marginRowRef.current.offsetHeight);
  }, [data, change]);

  const rowsById = React.useMemo(() => Object.fromEntries(data.rows.map((r) => [r.id, r])), [data.rows]);

  // Display columns: month/year columns + a Total column (except annual mode).
  const displayCols: PnlColumn[] = React.useMemo(() => {
    if (data.mode === "annual") return data.columns;
    const allKeys = data.columns.flatMap((c) => c.monthKeys);
    return [...data.columns, { key: "__total__", label: "Total", monthKeys: allKeys }];
  }, [data.columns, data.mode]);

  const canMoM = data.mode !== "annual";

  const aggVal = (row: PnlRow | undefined, col: PnlColumn) => (row ? sumKeys(row.monthly, col.monthKeys) : 0);
  const pctVal = (row: PnlRow, col: PnlColumn): number | null => {
    if (!row.pctBaseId) return null;
    const base = aggVal(rowsById[row.pctBaseId], col);
    const num = aggVal(rowsById[row.numeratorId ?? row.id], col);
    return base ? (num / base) * 100 : null;
  };
  const periodShift = data.mode === "quarterly" ? -3 : data.mode === "annual" ? -12 : -1;
  const momLabel = data.mode === "quarterly" ? "QoQ %" : "MoM %";
  const deltaVal = (row: PnlRow, col: PnlColumn): number | null => {
    if (change === "abs" || col.key === "__total__" || row.kind === "margin") return null;
    const shift = change === "mom" ? periodShift : -12;
    const cur = aggVal(row, col);
    const base = col.monthKeys.reduce((a, k) => a + (row.monthly[addMonths(k, shift)] ?? 0), 0);
    if (!base) return null;
    return ((cur - base) / Math.abs(base)) * 100;
  };
  const goodWhenUp = (r: PnlRow) => r.kind === "revenue" || r.kind === "subtotal" || r.kind === "total" || r.kind === "cm" || r.kind === "margin";

  function cellText(row: PnlRow, v: number): string {
    if (row.kind === "margin") return "";
    if (v === 0) return "–";
    if (row.kind === "deduction" || row.kind === "expense") return v > 0 ? `−${money(v)}` : `+${money(-v)}`;
    return v < 0 ? `−${money(v)}` : money(v);
  }

  function openDrill(row: PnlRow, col: PnlColumn) {
    if (!row.drill) return;
    const from = `${col.monthKeys[0]}-01`;
    const to = lastDayIso(col.monthKeys[col.monthKeys.length - 1]);
    setDrill({ title: row.label, subtitle: col.key === "__total__" ? data.periodLabel : col.label, key: row.drill, from, to, total: aggVal(row, col) });
  }

  // ── period controls ──
  const goMode = (mode: string) => {
    if (mode === "custom") navigate(`/dashboard/pnl?mode=custom&from=${data.from}&to=${data.to}`);
    else navigate(`/dashboard/pnl?mode=${mode}&fy=${data.fyStart}`);
  };
  const today = new Date().toISOString().slice(0, 10);
  const exportHref = (fmt: string) => {
    const q = new URLSearchParams({ mode: data.mode, fy: String(data.fyStart), format: fmt });
    if (data.mode === "custom") { q.set("from", data.from ?? ""); q.set("to", data.to ?? ""); }
    return `/api/pnl/export?${q}`;
  };

  const ModeBtn = ({ m, label }: { m: string; label: string }) => (
    <button onClick={() => goMode(m)} className={cn("h-8 px-3 text-[12px] font-medium transition-colors", data.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{label}</button>
  );

  return (
    <TipCtx.Provider value={setTipCb}>
    <div className="space-y-3 max-w-[1400px]">
      <PageHeader title="Profit & Loss" subtitle={`Month-wise P&L · ${data.periodLabel}`}>
        {/* view mode */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <ModeBtn m="monthly" label="Monthly" />
          <ModeBtn m="quarterly" label="Quarterly" />
          <ModeBtn m="annual" label="Annual" />
          <ModeBtn m="custom" label="Custom" />
        </div>

        {/* FY dropdown (monthly + annual) */}
        {data.mode !== "custom" && (
          <div className="relative">
            <button onClick={() => setFyOpen((o) => !o)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12.5px] font-medium hover:bg-muted">
              {data.mode === "annual" ? `ending FY ${data.fyStart}-${String((data.fyStart + 1) % 100).padStart(2, "0")}` : `FY ${data.fyStart}-${String((data.fyStart + 1) % 100).padStart(2, "0")}`}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {fyOpen && (
              <>
                <div className="fixed inset-0 z-[90]" onClick={() => setFyOpen(false)} />
                <div className="absolute right-0 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-[91] py-1">
                  {years.map((y) => (
                    <button key={y} onClick={() => { setFyOpen(false); navigate(`/dashboard/pnl?mode=${data.mode}&fy=${y}`); }}
                      className={cn("w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-muted", y === data.fyStart ? "text-primary font-semibold" : "text-foreground")}>
                      FY {y}-{String((y + 1) % 100).padStart(2, "0")}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* custom range — shared styled picker (presets + calendar), used across tabs */}
        {data.mode === "custom" && (
          <DateRangePicker
            from={data.from ?? today}
            to={data.to ?? today}
            max={today}
            align="end"
            onChange={(f, t) => navigate(`/dashboard/pnl?mode=custom&from=${f}&to=${t}`)}
          />
        )}

        {/* change toggle */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {(canMoM ? ([["abs", "Absolute"], ["mom", momLabel], ["yoy", "YoY %"]] as [Mode, string][]) : ([["abs", "Absolute"], ["yoy", "YoY %"]] as [Mode, string][])).map(([m, label]) => (
            <button key={m} onClick={() => setChange(m)} className={cn("h-8 px-2.5 text-[12px] font-medium transition-colors", change === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>{label}</button>
          ))}
        </div>

        {!data.preview && (
          <div className="inline-flex gap-1.5">
            <a href={exportHref("csv")} className="inline-flex items-center gap-1 text-[12px] h-8 px-2.5 rounded-lg border border-border hover:bg-muted"><Download className="h-3.5 w-3.5" /> CSV</a>
            <a href={exportHref("xlsx")} className="inline-flex items-center gap-1 text-[12px] h-8 px-2.5 rounded-lg border border-border hover:bg-muted"><Download className="h-3.5 w-3.5" /> Excel</a>
          </div>
        )}
      </PageHeader>

      {data.preview && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-[12.5px] text-foreground/80 flex-1 min-w-0"><span className="font-semibold text-foreground">Preview — sample data.</span> Connect a source to replace this with your real P&L.</p>
          <Link href="/dashboard/connectors" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0"><Zap className="h-3.5 w-3.5" /> Connect</Link>
        </div>
      )}

      {/* grid — own scroll box so the header (top) and Net Profit/Margin (bottom) stay frozen */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-215px)]">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="sticky left-0 top-0 z-[6] bg-card text-left font-semibold text-muted-foreground px-3 py-2.5 min-w-[240px] border-r border-border">Particulars</th>
                {displayCols.map((c) => (
                  <th key={c.key} className={cn("sticky top-0 z-[4] bg-card text-right font-semibold text-muted-foreground px-3 py-2.5 whitespace-nowrap min-w-[96px] border-l border-border/60", c.key === "__total__" && "font-bold text-foreground")}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const strong = row.emphasis === "strong";
                const isCm = row.emphasis === "cm";
                const isTotalRow = row.kind === "total";
                const isMargin = row.kind === "margin";
                const isNetProfit = row.id === "net_profit";
                const isNetMargin = row.id === "net_margin";
                const isFooter = isNetProfit || isNetMargin;
                const footerBottom = isNetMargin ? 0 : marginH;
                return (
                  <React.Fragment key={row.id}>
                    {row.section && (
                      <tr>
                        <td colSpan={displayCols.length + 1} className="sticky left-0 bg-card px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{row.section}</td>
                      </tr>
                    )}
                    <tr
                      ref={isNetMargin ? marginRowRef : undefined}
                      className={cn(
                        "border-b border-border/50",
                        !isFooter && strong && "bg-muted/40",
                        !isFooter && isCm && "bg-primary/[0.055]",
                        !isFooter && isTotalRow && "bg-primary/[0.09]",
                        isNetProfit && "border-t-2 border-border"
                      )}
                    >
                      <td
                        style={isFooter ? { bottom: footerBottom } : undefined}
                        className={cn(
                          "sticky left-0 px-3 py-2 whitespace-nowrap border-r border-border",
                          isFooter
                            ? cn("z-[4] bg-muted text-foreground", isNetProfit && "font-bold")
                            : cn(
                                "z-[1]",
                                strong ? "bg-muted/60 font-bold text-foreground" : isCm ? "bg-primary/[0.055] font-semibold text-foreground" : "bg-card text-foreground/90",
                                isTotalRow && "bg-primary/[0.09] font-bold",
                                row.kind === "expense" && "pl-6 text-muted-foreground font-normal"
                              )
                        )}
                      >{row.label}</td>
                      {displayCols.map((col) => {
                        const v = aggVal(row, col);
                        const pct = pctVal(row, col);
                        const delta = deltaVal(row, col);
                        const drillable = Boolean(row.drill) && v !== 0;
                        const full = isMargin ? (pct == null ? "—" : `${pct.toFixed(1)}%`) : moneyFull(v);
                        const valueCls = cn(
                          "inline-block leading-tight",
                          drillable && "hover:underline decoration-dotted cursor-pointer",
                          isTotalRow && (v < 0 ? "text-destructive font-bold" : "text-success font-bold"),
                          (strong || isCm) && !isTotalRow && "font-semibold"
                        );
                        const inner = isMargin
                          ? (pct == null ? "–" : <span className={pct < 0 ? "text-destructive" : "text-foreground"}>{pct.toFixed(1)}%</span>)
                          : cellText(row, v);
                        return (
                          <td
                            key={col.key}
                            style={isFooter ? { bottom: footerBottom } : undefined}
                            className={cn(
                              "text-right px-3 py-2 num align-top border-l border-border/60",
                              isFooter ? "sticky z-[3] bg-muted" : col.key === "__total__" && "bg-muted/30"
                            )}
                            onMouseEnter={(e) => v !== 0 && setTipCb(full, e.clientX, e.clientY)}
                            onMouseMove={(e) => v !== 0 && setTipCb(full, e.clientX, e.clientY)}
                            onMouseLeave={() => setTipCb(null)}
                          >
                            {drillable ? (
                              <button type="button" onClick={() => openDrill(row, col)} className={valueCls}>{inner}</button>
                            ) : (
                              <span className={valueCls}>{inner}</span>
                            )}
                            {isCm && pct != null && (
                              <div className="text-[10px] text-primary/80 mt-0.5">{pct.toFixed(0)}% margin</div>
                            )}
                            {delta != null && (
                              <span className={cn("flex items-center justify-end gap-0.5 text-[10px] mt-0.5", (delta >= 0) === goodWhenUp(row) ? "text-success" : "text-destructive")}>
                                {delta >= 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}{Math.abs(delta).toFixed(0)}%
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
        Revenue ties to your dashboard. <span className="font-medium text-foreground/70">Payment Gateway Fees</span> includes gateway charges + Apple App Store commission.
        CM tiers are % of Net Revenue. Click any cell to drill in by vendor/customer.
      </p>

      {/* exact-figure tooltip */}
      {tip && (
        <div className="fixed z-[200] pointer-events-none px-2 py-1 rounded-md bg-foreground text-background text-[11px] font-medium num shadow-lg" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.text}</div>
      )}

      <DrillDrawer orgId={orgId} open={drill != null} onClose={() => setDrill(null)}
        title={drill?.title ?? ""} subtitle={drill?.subtitle ?? ""} drillKey={drill?.key ?? null}
        from={drill?.from ?? ""} to={drill?.to ?? ""} expectedTotal={drill?.total ?? 0} />
    </div>
    </TipCtx.Provider>
  );
}
