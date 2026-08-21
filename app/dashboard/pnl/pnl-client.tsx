"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { Download, Sparkles, Zap, X, ChevronDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useNavProgress } from "@/components/dashboard/nav-progress";
import { PageHeader } from "@/components/dashboard/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import type { PnlData, PnlRow } from "@/lib/pnl";

type Mode = "abs" | "mom" | "yoy";

// ─── number helpers ───────────────────────────────────────────────────────────
const money = (n: number) => formatCurrency(Math.abs(n), "INR", true);
const moneyFull = (n: number) => formatCurrency(n, "INR", false);

function prevMonthKey(k: string): string {
  const [y, m] = k.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const prevYearKey = (k: string): string => {
  const [y, m] = k.split("-");
  return `${Number(y) - 1}-${m}`;
};
function pct(cur: number, base: number): number | null {
  if (!base) return null;
  return ((cur - base) / Math.abs(base)) * 100;
}

// A row where "up" is a good thing (revenue, profit, margin) vs a cost row.
const goodWhenUp = (r: PnlRow) => r.kind === "revenue" || r.kind === "subtotal" || r.kind === "total" || r.kind === "margin";
const isDrillable = (r: PnlRow) => Boolean(r.drill);

// Cell text for a value, respecting the row's presentation.
function cellText(row: PnlRow, v: number): string {
  if (row.kind === "margin") return `${v.toFixed(1)}%`;
  if (v === 0) return "–";
  if (row.kind === "deduction" || row.kind === "expense") return `−${money(v)}`;
  if (v < 0) return `−${money(v)}`;
  return money(v);
}

// ─── Drill drawer ──────────────────────────────────────────────────────────────
type DrillTxn = {
  id: string; transaction_date: string; counterparty_name: string | null;
  amount: number; currency: string | null; source: string | null;
  status: string | null; category: string | null; type: string; fee: number | null;
};

function DrillDrawer({
  orgId, open, onClose, title, subtitle, drillKey, from, to, expectedTotal,
}: {
  orgId: string; open: boolean; onClose: () => void;
  title: string; subtitle: string; drillKey: string | null; from: string; to: string; expectedTotal: number;
}) {
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<DrillTxn[]>([]);
  const [count, setCount] = React.useState(0);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !drillKey) return;
    let cancelled = false;
    setLoading(true); setErr(null); setRows([]);
    const q = new URLSearchParams({ org: orgId, key: drillKey, from, to });
    fetch(`/api/pnl/drill?${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
        return r.json();
      })
      .then((d) => { if (!cancelled) { setRows(d.rows ?? []); setCount(d.count ?? 0); } })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, drillKey, orgId, from, to]);

  const total = expectedTotal;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[140] animate-in fade-in" />
        <Dialog.Content className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-card border-l border-border z-[141] shadow-2xl flex flex-col focus:outline-none">
          <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
            <div className="min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-foreground truncate">{title}</Dialog.Title>
              <p className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</p>
            </div>
            <Dialog.Close className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center flex-shrink-0">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">{loading ? "Loading…" : `${count.toLocaleString("en-IN")} transactions`}</span>
            <span className="num text-[13px] font-semibold text-foreground" title="Total from the P&L rollup">{moneyFull(total)}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {err && <p className="p-4 text-[12px] text-destructive">{err}</p>}
            {loading && (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
              </div>
            )}
            {!loading && !err && rows.length === 0 && (
              <p className="p-6 text-center text-[12px] text-muted-foreground">No transactions in this slice.</p>
            )}
            {!loading && rows.map((t) => (
              <div key={t.id} className="px-4 py-2.5 border-b border-border/60 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] text-foreground truncate">{t.counterparty_name || "—"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(t.transaction_date)}{t.source ? ` · ${t.source}` : ""}{t.category ? ` · ${t.category}` : ""}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="num text-[12.5px] font-medium text-foreground">
                    {t.fee != null ? moneyFull(t.fee) : formatCurrency(t.amount, t.currency || "INR", false)}
                  </p>
                  {t.status && <p className="text-[10.5px] text-muted-foreground">{t.status}</p>}
                </div>
              </div>
            ))}
            {!loading && count > rows.length && (
              <p className="p-4 text-center text-[11px] text-muted-foreground">Showing first {rows.length} of {count.toLocaleString("en-IN")}.</p>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export function PnlClient({ data, orgId, years }: { data: PnlData; orgId: string; years: number[] }) {
  const { navigate } = useNavProgress();
  const [mode, setMode] = React.useState<Mode>("abs");
  const [fyOpen, setFyOpen] = React.useState(false);
  const [drill, setDrill] = React.useState<{ title: string; subtitle: string; key: string; from: string; to: string; total: number } | null>(null);

  const monthKeys = data.months.map((m) => m.key);
  const fyFrom = `${data.fyStart}-04-01`;
  const fyTo = `${data.fyStart + 1}-03-31`;

  const lastDay = (k: string) => {
    const [y, m] = k.split("-").map(Number);
    return `${k}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
  };

  function openDrill(row: PnlRow, monthKey: string | null) {
    if (!row.drill) return;
    const from = monthKey ? `${monthKey}-01` : fyFrom;
    const to = monthKey ? lastDay(monthKey) : fyTo;
    const when = monthKey ? (data.months.find((m) => m.key === monthKey)?.label ?? monthKey) : data.fyLabel;
    const total = monthKey ? (row.values[monthKey] ?? 0) : row.total;
    setDrill({ title: row.label, subtitle: when, key: row.drill, from, to, total });
  }

  const changeFor = (row: PnlRow, k: string): number | null => {
    if (mode === "abs" || row.kind === "margin") return null;
    const cur = row.values[k] ?? 0;
    const base = row.values[mode === "mom" ? prevMonthKey(k) : prevYearKey(k)] ?? 0;
    return pct(cur, base);
  };

  return (
    <div className="space-y-3 max-w-[1400px]">
      <PageHeader title="Profit & Loss" subtitle={`Month-wise P&L · ${data.fyLabel} (Apr–Mar)`}>
        {/* FY selector */}
        <div className="relative">
          <button
            onClick={() => setFyOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12.5px] font-medium hover:bg-muted"
          >
            {data.fyLabel} <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {fyOpen && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setFyOpen(false)} />
              <div className="absolute right-0 mt-1 w-40 rounded-lg border border-border bg-card shadow-lg z-[91] py-1">
                {years.map((y) => (
                  <button
                    key={y}
                    onClick={() => { setFyOpen(false); navigate(`/dashboard/pnl?fy=${y}`); }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-muted",
                      y === data.fyStart ? "text-primary font-semibold" : "text-foreground"
                    )}
                  >
                    FY {y}-{String((y + 1) % 100).padStart(2, "0")}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Mode toggle */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          {([["abs", "Absolute"], ["mom", "MoM %"], ["yoy", "YoY %"]] as [Mode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "h-8 px-2.5 text-[12px] font-medium transition-colors",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Export */}
        {!data.preview && (
          <div className="inline-flex gap-1.5">
            <a href={`/api/pnl/export?fy=${data.fyStart}&format=csv`} className="inline-flex items-center gap-1 text-[12px] h-8 px-2.5 rounded-lg border border-border hover:bg-muted">
              <Download className="h-3.5 w-3.5" /> CSV
            </a>
            <a href={`/api/pnl/export?fy=${data.fyStart}&format=xlsx`} className="inline-flex items-center gap-1 text-[12px] h-8 px-2.5 rounded-lg border border-border hover:bg-muted">
              <Download className="h-3.5 w-3.5" /> Excel
            </a>
          </div>
        )}
      </PageHeader>

      {data.preview && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-[12.5px] text-foreground/80 flex-1 min-w-0">
            <span className="font-semibold text-foreground">Preview — sample data.</span>{" "}
            Connect a source to replace this with your real P&L.
          </p>
          <Link href="/dashboard/connectors" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0">
            <Zap className="h-3.5 w-3.5" /> Connect
          </Link>
        </div>
      )}

      {/* The grid */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-[2] bg-card text-left font-semibold text-muted-foreground px-3 py-2.5 min-w-[220px]">
                  Line item
                </th>
                {data.months.map((m) => (
                  <th key={m.key} className="text-right font-semibold text-muted-foreground px-3 py-2.5 whitespace-nowrap min-w-[92px]">
                    {m.label}
                  </th>
                ))}
                <th className="text-right font-bold text-foreground px-3 py-2.5 whitespace-nowrap min-w-[100px] bg-muted/40 border-l border-border">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const strong = row.kind === "subtotal" || row.kind === "total";
                const isTotalRow = row.kind === "total";
                const isMargin = row.kind === "margin";
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border/50 last:border-0",
                      strong && "bg-muted/30",
                      isTotalRow && "bg-primary/[0.05]"
                    )}
                  >
                    <td className={cn(
                      "sticky left-0 z-[1] px-3 py-2 whitespace-nowrap",
                      strong ? "bg-muted/40 font-semibold text-foreground" : "bg-card text-foreground/90",
                      isTotalRow && "bg-primary/[0.05] font-bold",
                      row.kind === "expense" && "pl-6 text-muted-foreground"
                    )}>
                      {row.label}
                    </td>
                    {data.months.map((m) => {
                      const v = row.values[m.key] ?? 0;
                      const ch = changeFor(row, m.key);
                      const drillable = isDrillable(row) && v !== 0;
                      return (
                        <td key={m.key} className="text-right px-3 py-2 num align-top">
                          <button
                            type="button"
                            disabled={!drillable}
                            onClick={() => openDrill(row, m.key)}
                            title={isMargin ? `${v.toFixed(1)}%` : moneyFull(v)}
                            className={cn(
                              "inline-block leading-tight",
                              drillable && "hover:underline decoration-dotted cursor-pointer",
                              isTotalRow && (v < 0 ? "text-destructive font-bold" : "text-success font-bold"),
                              isMargin && (v < 0 ? "text-destructive" : "text-foreground"),
                              strong && !isTotalRow && "font-semibold"
                            )}
                          >
                            {cellText(row, v)}
                          </button>
                          {ch != null && (
                            <span className={cn(
                              "flex items-center justify-end gap-0.5 text-[10px] mt-0.5",
                              (ch >= 0) === goodWhenUp(row) ? "text-success" : "text-destructive"
                            )}>
                              {ch >= 0 ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
                              {Math.abs(ch).toFixed(0)}%
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className={cn(
                      "text-right px-3 py-2 num bg-muted/40 border-l border-border align-top",
                      strong ? "font-bold text-foreground" : "font-medium text-foreground/90",
                      isTotalRow && (row.total < 0 ? "text-destructive" : "text-success")
                    )}>
                      <button
                        type="button"
                        disabled={!(isDrillable(row) && row.total !== 0)}
                        onClick={() => openDrill(row, null)}
                        title={isMargin ? `${row.total.toFixed(1)}%` : moneyFull(row.total)}
                        className={cn(isDrillable(row) && row.total !== 0 && "hover:underline decoration-dotted cursor-pointer")}
                      >
                        {cellText(row, row.total)}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground px-1">
        Revenue ties to your dashboard. <span className="font-medium text-foreground/70">Payment Gateway Fees</span> includes payment-gateway charges and Apple App Store commission.
        Click any cell to see the underlying transactions.
      </p>

      <DrillDrawer
        orgId={orgId}
        open={drill != null}
        onClose={() => setDrill(null)}
        title={drill?.title ?? ""}
        subtitle={drill?.subtitle ?? ""}
        drillKey={drill?.key ?? null}
        from={drill?.from ?? fyFrom}
        to={drill?.to ?? fyTo}
        expectedTotal={drill?.total ?? 0}
      />
    </div>
  );
}
