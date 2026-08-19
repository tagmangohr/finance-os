"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Landmark, Search, Download, Sparkles, Wand2, TrendingUp, TrendingDown,
  Wallet, AlertTriangle, ArrowDownRight, ArrowUpRight, Plug,
} from "lucide-react";
import { useNavProgress } from "@/components/dashboard/nav-progress";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { BankOverview, BankTxn } from "@/lib/expenses/reports";
import type { LedgerCategory } from "@/lib/expenses/types";
import { DateRangePicker } from "@/components/ui/date-range-picker";

const s = (v: unknown) => (v == null ? "" : String(v));
const inr = (n: number, compact = false) => formatCurrency(n, "INR", compact);
const runwayLabel = (days: number) => (days >= 9999 ? "∞" : days >= 365 ? `${(days / 365).toFixed(1)} yr` : days >= 60 ? `${Math.round(days / 30)} mo` : `${days} d`);

const TREATMENT_STYLE: Record<string, string> = {
  expense: "bg-amber-500/15 text-amber-600",
  income: "bg-emerald-500/15 text-emerald-600",
  excluded: "bg-neutral-500/15 text-neutral-500",
  uncategorized: "bg-rose-500/15 text-rose-600",
};
const SOURCE_STYLE: Record<string, string> = {
  manual: "bg-sky-500/15 text-sky-600",
  rule: "bg-primary/15 text-primary",
  ai: "bg-fuchsia-500/15 text-fuchsia-600",
};
const STATUS_STYLE: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-600",
  pending: "bg-amber-500/15 text-amber-600",
  failed: "bg-rose-500/15 text-rose-600",
  refunded: "bg-sky-500/15 text-sky-600",
};
const ACCOUNT_LABEL: Record<string, string> = {
  checking: "Checking", savings: "Savings", treasury: "Treasury",
  investment: "Investment", credit: "Credit Card", external: "External",
};
const acctLabel = (k: string | null) => (k ? ACCOUNT_LABEL[k.toLowerCase()] ?? (k[0].toUpperCase() + k.slice(1)) : "—");
// Transaction time is stored as a precise UTC timestamp (transaction_at); render
// it in IST (the reporting timezone) — date from the timestamp so it never drifts.
const IST_DATE = { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" } as const;
const IST_TIME = { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: true } as const;

type Filter = "all" | "expense" | "income" | "excluded" | "review";
const PAGE = 50;

export function BankClient({ data, hasBankConnector }: { data: BankOverview; hasBankConnector: boolean }) {
  const router = useRouter();
  const { navigate } = useNavProgress();
  const { totals, categories, byCategory, byCard, monthly, runway } = data;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "pending" | "failed" | "refunded">("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [cardFilter, setCardFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  // Distinct Mercury account types present, for the Account filter.
  const accountTypes = useMemo(
    () => Array.from(new Set(data.transactions.map((t) => t.account_type).filter((x): x is string => !!x))).sort(),
    [data.transactions]
  );
  // Distinct cards present (last4), for the Card filter.
  const cards = useMemo(
    () => Array.from(new Set(data.transactions.map((t) => t.card_last4).filter((x): x is string => !!x))).sort(),
    [data.transactions]
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [categorizing, startCategorize] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Category options grouped by P&L treatment for the inline picker.
  const grouped = useMemo(() => {
    const g: Record<string, LedgerCategory[]> = { expense: [], income: [], excluded: [], uncategorized: [] };
    for (const c of categories) (g[c.treatment] ??= []).push(c);
    return g;
  }, [categories]);

  const needsReview = (t: BankTxn) =>
    !t.pnl_treatment || t.pnl_treatment === "uncategorized" ||
    (t.category_source === "ai" && (t.category_confidence ?? 1) < 0.6);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return data.transactions.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (accountFilter !== "all" && r.account_type !== accountFilter) return false;
      if (cardFilter !== "all" && r.card_last4 !== cardFilter) return false;
      if (filter === "review" && !needsReview(r)) return false;
      if (filter !== "all" && filter !== "review" && (r.pnl_treatment ?? "uncategorized") !== filter) return false;
      if (!t) return true;
      return [r.counterparty_name, r.description, r.category, r.external_id, r.card_last4, r.card_holder].some((v) => s(v).toLowerCase().includes(t));
    }).sort((a, b) => {
      // Newest first by precise timestamp; fall back to date when transaction_at is null.
      const ta = a.transaction_at ? Date.parse(a.transaction_at) : Date.parse(a.transaction_date);
      const tb = b.transaction_at ? Date.parse(b.transaction_at) : Date.parse(b.transaction_date);
      return tb - ta;
    });
  }, [data.transactions, q, filter, statusFilter, accountFilter, cardFilter]);

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));

  async function assign(id: string, slug: string) {
    if (!slug) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/expenses/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], slug, remember: true }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      if (j.backfilled > 0) setMsg(`Applied to ${j.backfilled} more transaction(s) from the same counterparty.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to categorize");
    } finally {
      setSavingId(null);
    }
  }

  function runCategorize() {
    startCategorize(async () => {
      setMsg(null);
      try {
        const res = await fetch("/api/expenses/categorize", { method: "POST" });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Failed");
        setMsg(
          j.scanned === 0
            ? "Everything is already categorized."
            : `Categorized ${(j.systemApplied ?? 0) + j.ruleApplied + j.aiApplied} of ${j.scanned}` +
              ` (${(j.systemApplied ?? 0) + j.ruleApplied} by rules${j.aiUsed ? `, ${j.aiApplied} by AI` : ""})` +
              (j.remaining > 0 ? ` — ${j.remaining} left for manual review${j.aiUsed ? "" : " (set ANTHROPIC_API_KEY to auto-classify the rest)"}.` : "."),
        );
        router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : "Categorization failed");
      }
    });
  }

  // ── Empty state: no bank feed connected yet ──
  if (!hasBankConnector && data.transactions.length === 0) {
    return (
      <div className="max-w-[1400px]">
        <div className="rounded-xl border border-border bg-card p-10 text-center animate-enter">
          <Landmark className="size-8 mx-auto text-muted-foreground/60" />
          <h2 className="mt-3 text-lg font-semibold">Connect your bank to see cash flow</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Link your Mercury account (read-only) to pull bank transactions here. They&apos;re auto-categorized so
            your expenses feed the P&amp;L — while gateway inflows stay out of revenue (no double-counting).
          </p>
          <Link href="/dashboard/connectors" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plug className="size-4" /> Connect Mercury
          </Link>
        </div>
      </div>
    );
  }

  const maxCat = Math.max(1, ...byCategory.map((c) => c.amount));
  const maxCard = Math.max(1, ...byCard.map((c) => Math.abs(c.amount)));
  // Count "needs review" with the SAME predicate as the row badge + filter (no
  // status gate), so the metric, the "Needs review" filter, and the highlighted
  // rows always agree — including pending-uncategorized and low-confidence AI.
  const reviewCount = data.transactions.filter(needsReview).length;

  return (
    <div className="space-y-3 max-w-[1400px]">
      {/* Header — date range + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateRangePicker
          from={data.period.from}
          to={data.period.to}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(f, t) => navigate(`/dashboard/bank?from=${f}&to=${t}`)}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={runCategorize}
            disabled={categorizing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-border/60 disabled:opacity-60"
          >
            <Wand2 className={cn("size-3.5", categorizing && "animate-pulse")} />
            {categorizing ? "Categorizing…" : "Auto-categorize"}
          </button>
          <a href={`/api/bank/export?treatment=all&format=csv&from=${data.period.from}&to=${data.period.to}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-border/60"><Download className="size-3.5" />CSV</a>
          <a href={`/api/bank/export?treatment=all&format=xlsx&from=${data.period.from}&to=${data.period.to}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-border/60"><Download className="size-3.5" />Excel</a>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground px-1">
        Bank ledger · {data.period.from} → {data.period.to} · {totals.txnCount.toLocaleString("en-IN")} transactions
      </p>

      {msg && (
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
          <Sparkles className="size-3.5 text-primary" />{msg}
        </div>
      )}

      {/* Reconciled P&L */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter">
        <MetricCard title="Net P&L" value={inr(totals.net, true)} icon={totals.net >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />} accentColor={totals.net >= 0 ? "#10b981" : "#f43f5e"} subtitle="Collections + other income − expenses" />
        <MetricCard title="Collections (PG)" value={inr(totals.collections, true)} icon={<ArrowUpRight className="size-4" />} subtitle="From payment gateways" />
        <MetricCard title="Expenses" value={inr(totals.expenses, true)} icon={<ArrowDownRight className="size-4" />} accentColor="#f59e0b" subtitle="Categorized bank outflows" />
        <MetricCard title="Other income" value={inr(totals.otherIncome, true)} icon={<ArrowUpRight className="size-4" />} accentColor="#10b981" subtitle="Non-PG receipts (invoices, interest)" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter-1">
        <MetricCard title="Cash balance" value={inr(runway.cashBalance, true)} icon={<Wallet className="size-4" />} subtitle="Approx. (Mercury + PG net)" />
        <MetricCard title="Monthly burn" value={inr(runway.burnRate, true)} icon={<TrendingDown className="size-4" />} subtitle="Avg last 90 days" />
        <MetricCard title="Runway" value={runwayLabel(runway.runwayDays)} icon={<Wallet className="size-4" />} severity={runway.runwayDays <= 120 ? "warning" : undefined} subtitle="Cash ÷ burn" />
        <MetricCard title="Needs review" value={reviewCount.toLocaleString("en-IN")} icon={<AlertTriangle className="size-4" />} severity={reviewCount > 0 ? "warning" : undefined} subtitle="Uncategorized or low-confidence (all statuses)" />
      </div>

      <div className="grid lg:grid-cols-2 gap-3 animate-enter-1">
        {/* Expenses by category */}
        <SectionCard title="Expenses by category" subtitle="Categorized outflows in range">
          {byCategory.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">No categorized expenses yet — run auto-categorize or classify transactions below.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-auto">
              {byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-2 text-xs">
                  <div className="w-32 shrink-0 truncate">{c.label}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                  </div>
                  <div className="w-20 text-right tabular-nums">{inr(c.amount, true)}</div>
                  <div className="w-8 text-right tabular-nums text-muted-foreground">{c.count}</div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Monthly P&L */}
        <SectionCard title="Monthly P&L" subtitle="Collections vs expenses vs net">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground border-b border-border/50 sticky top-0 bg-card">
                <th className="py-1.5 font-medium">Month</th>
                <th className="font-medium text-right">Collections</th>
                <th className="font-medium text-right">Other inc.</th>
                <th className="font-medium text-right">Expenses</th>
                <th className="font-medium text-right">Net</th>
              </tr></thead>
              <tbody>
                {monthly.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">No data yet.</td></tr>
                ) : monthly.map((m) => (
                  <tr key={m.month} className="border-b border-border/30">
                    <td className="py-1.5">{m.month}</td>
                    <td className="text-right tabular-nums">{inr(m.collections, true)}</td>
                    <td className="text-right tabular-nums text-emerald-600">{m.otherIncome ? inr(m.otherIncome, true) : "—"}</td>
                    <td className="text-right tabular-nums text-amber-600">{m.expenses ? inr(m.expenses, true) : "—"}</td>
                    <td className={cn("text-right tabular-nums font-medium", m.net >= 0 ? "text-emerald-600" : "text-rose-600")}>{inr(m.net, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* Spend by card */}
      {byCard.length > 0 && (
        <SectionCard title="Spend by card" subtitle="Net card spend (swipes − refunds) in range · click to filter">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
            {byCard.map((c) => (
              <button
                key={c.last4}
                onClick={() => { setCardFilter(c.last4); setPage(0); }}
                className={cn("flex items-center gap-2 text-xs rounded-md px-1.5 py-1 text-left hover:bg-muted/50", cardFilter === c.last4 && "bg-muted")}
              >
                <div className="w-36 shrink-0 truncate">
                  <span className="tabular-nums">•• {c.last4}</span>
                  {c.holder && <span className="text-muted-foreground"> · {c.holder.split("@")[0]}</span>}
                </div>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-sky-500/70" style={{ width: `${(Math.abs(c.amount) / maxCard) * 100}%` }} />
                </div>
                <div className="w-20 text-right tabular-nums">{inr(c.amount, true)}</div>
                <div className="w-8 text-right tabular-nums text-muted-foreground">{c.count}</div>
              </button>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Transactions */}
      <SectionCard
        title="Transactions"
        subtitle={`${filtered.length.toLocaleString("en-IN")} shown`}
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1">
              <Search className="size-3.5 text-muted-foreground" />
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search counterparty, memo…" className="bg-transparent text-xs outline-none w-40" />
            </div>
            <select value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setPage(0); }} className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none">
              <option value="all">All</option>
              <option value="expense">Expenses</option>
              <option value="income">Income</option>
              <option value="excluded">Excluded</option>
              <option value="review">Needs review</option>
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as typeof statusFilter); setPage(0); }} className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none">
              <option value="all">Any status</option>
              <option value="completed">Completed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="refunded">Refunded</option>
            </select>
            {accountTypes.length > 1 && (
              <select value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(0); }} className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none">
                <option value="all">All accounts</option>
                {accountTypes.map((a) => <option key={a} value={a}>{acctLabel(a)}</option>)}
              </select>
            )}
            {cards.length > 0 && (
              <select value={cardFilter} onChange={(e) => { setCardFilter(e.target.value); setPage(0); }} className="rounded-lg border border-border bg-background px-2 py-1 text-xs outline-none">
                <option value="all">All cards</option>
                {cards.map((c) => <option key={c} value={c}>{`•• ${c}`}</option>)}
              </select>
            )}
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50">
              <th className="py-1.5 font-medium">Date</th>
              <th className="font-medium">Time (IST)</th>
              <th className="font-medium">Counterparty</th>
              <th className="font-medium">Account</th>
              <th className="font-medium">Card</th>
              <th className="font-medium">Description</th>
              <th className="font-medium text-right">Amount</th>
              <th className="font-medium text-right">USD</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">Category</th>
              <th className="font-medium">P&L</th>
              <th className="font-medium">By</th>
            </tr></thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={12} className="py-8 text-center text-muted-foreground">No transactions match.</td></tr>
              ) : pageRows.map((t) => (
                <tr key={t.id} className={cn("border-b border-border/30", needsReview(t) && "bg-rose-500/[0.03]")}>
                  <td className="py-1.5 whitespace-nowrap text-muted-foreground">{t.transaction_at ? new Date(t.transaction_at).toLocaleDateString("en-GB", IST_DATE) : formatDate(t.transaction_date)}</td>
                  <td className="py-1.5 whitespace-nowrap text-muted-foreground">{t.transaction_at ? new Date(t.transaction_at).toLocaleTimeString("en-IN", IST_TIME) : "—"}</td>
                  <td className="max-w-[180px] truncate">{t.counterparty_name ?? "—"}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{acctLabel(t.account_type)}</td>
                  <td className="whitespace-nowrap text-muted-foreground">
                    {t.card_last4 ? (
                      <span title={t.card_holder ?? undefined}>•• {t.card_last4}{t.card_holder ? ` · ${t.card_holder.split("@")[0]}` : ""}</span>
                    ) : "—"}
                  </td>
                  <td className="max-w-[220px] truncate text-muted-foreground">{t.description ?? "—"}</td>
                  <td className={cn("text-right tabular-nums whitespace-nowrap", t.type === "credit" ? "text-emerald-600" : "text-foreground")}>
                    {t.type === "credit" ? "+" : "−"}{inr(Number(t.amount_base ?? t.amount))}
                  </td>
                  <td className="text-right tabular-nums whitespace-nowrap text-muted-foreground">
                    {t.currency !== "INR" ? `${t.type === "credit" ? "+" : "−"}${formatCurrency(Number(t.amount), t.currency)}` : "—"}
                  </td>
                  <td>
                    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", STATUS_STYLE[t.status] ?? "bg-neutral-500/10 text-neutral-500")}>
                      {t.status}
                    </span>
                  </td>
                  <td>
                    <select
                      value={t.category ?? ""}
                      disabled={savingId === t.id}
                      onChange={(e) => assign(t.id, e.target.value)}
                      className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs outline-none max-w-[160px] disabled:opacity-50"
                    >
                      <option value="" disabled>{savingId === t.id ? "Saving…" : "Uncategorized"}</option>
                      {(["expense", "income", "excluded"] as const).map((grp) => (
                        <optgroup key={grp} label={grp[0].toUpperCase() + grp.slice(1)}>
                          {(grouped[grp] ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-medium", TREATMENT_STYLE[t.pnl_treatment ?? "uncategorized"])}>
                      {t.pnl_treatment ?? "review"}
                    </span>
                  </td>
                  <td>
                    {t.category_source && (
                      <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium", SOURCE_STYLE[t.category_source] ?? "bg-neutral-500/10 text-neutral-500")}>
                        {t.category_source === "ai" && <Sparkles className="size-2.5" />}
                        {t.category_source}
                        {t.category_source === "ai" && t.category_confidence != null && ` ${Math.round(t.category_confidence * 100)}%`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
            <span>{filtered.length.toLocaleString("en-IN")} rows · page {page + 1} of {pageCount}</span>
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage(0)} className="rounded border border-border px-2 py-1 disabled:opacity-40">« First</button>
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Prev</button>
              <span className="flex items-center gap-1 px-1">
                Go to
                <input
                  type="number" min={1} max={pageCount} value={page + 1}
                  onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 1) setPage(Math.min(pageCount, Math.max(1, Math.floor(v))) - 1); }}
                  className="w-14 rounded border border-border bg-background px-1 py-0.5 text-center outline-none"
                />
              </span>
              <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Next</button>
              <button disabled={page >= pageCount - 1} onClick={() => setPage(pageCount - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Last »</button>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
