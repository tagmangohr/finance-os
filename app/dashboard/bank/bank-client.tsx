"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Landmark, Search, Download, Sparkles, Wand2, TrendingUp, TrendingDown,
  Wallet, AlertTriangle, ArrowDownRight, ArrowUpRight, Plug, Pencil, X, ChevronRight,
  Scissors, Undo2, Plus, Trash2,
} from "lucide-react";
import { useNavProgress } from "@/components/dashboard/nav-progress";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/dashboard/section-card";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { BankOverview, BankTxn, BankVendorGroup } from "@/lib/expenses/reports";
import type { LedgerCategory } from "@/lib/expenses/types";
import { DateRangePicker } from "@/components/ui/date-range-picker";

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

// ─── Category drill drawer (click an "Expenses by category" row) ───────────────
// Grouped by VENDOR: each counterparty appears ONCE (total + count) and expands to
// its transactions, newest first. Vendors ordered by largest spend. No row cap.
function CategoryDrillDrawer({
  drill, onClose, from, to,
}: {
  drill: { slug: string; label: string; amount: number; count: number } | null;
  onClose: () => void;
  from: string;
  to: string;
}) {
  const [groups, setGroups] = useState<BankVendorGroup[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const open = drill != null;

  useEffect(() => { if (open) { setQuery(""); setExpanded(new Set()); } }, [open, drill?.slug]);

  useEffect(() => {
    if (!open || !drill) return;
    let cancelled = false;
    setLoading(true);
    setGroups([]);
    const params = new URLSearchParams({ from, to, category: drill.slug, view: "expense", status: "all" });
    fetch(`/api/bank/drill-groups?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setGroups((d.groups ?? []) as BankVendorGroup[]);
        setTruncated(Boolean(d.truncated));
      })
      .catch(() => { if (!cancelled) setGroups([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, drill, from, to]);

  const ql = query.trim().toLowerCase();
  const shown = ql
    ? groups.filter((g) => g.name.toLowerCase().includes(ql) || g.txns.some((t) => (t.description ?? "").toLowerCase().includes(ql)))
    : groups;
  const txnCount = shown.reduce((s, g) => s + g.count, 0);

  const toggle = (key: string) =>
    setExpanded((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  const amt = (n: number, credit: boolean) => `${credit ? "+" : "−"}${inr(Math.abs(n))}`;

  return (
    <FloatingPanel
      open={open}
      onClose={onClose}
      title={drill?.label ?? ""}
      subtitle="Expense transactions in range"
      headerRight={<span className="num text-[13px] font-semibold text-foreground pr-1">{inr(drill?.amount ?? 0)}</span>}
      search={{ value: query, onChange: setQuery, placeholder: "Search vendor, memo…" }}
    >
      <div className="px-4 py-2 border-b border-border sticky top-0 bg-card/95 backdrop-blur z-[1]">
        <span className="text-[12px] text-muted-foreground">
          {loading ? "Loading…" : `${shown.length.toLocaleString("en-IN")} vendor${shown.length === 1 ? "" : "s"} · ${txnCount.toLocaleString("en-IN")} transaction${txnCount === 1 ? "" : "s"}`}
        </span>
      </div>
      {loading && <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted/50 animate-pulse" />)}</div>}
      {!loading && shown.length === 0 && <p className="p-6 text-center text-[12px] text-muted-foreground">{query ? "No matches." : "No transactions."}</p>}
      {!loading && shown.map((g) => {
        // A single-transaction entry (a one-off vendor, or a counterparty-less memo)
        // is shown as a plain row — nothing to expand.
        if (g.count === 1) {
          const t = g.txns[0];
          return (
            <div key={g.key} className="px-4 py-2 flex items-center gap-3 border-b border-border/40">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-foreground truncate">{g.name}</p>
                <p className="text-[11px] text-muted-foreground">{t.transaction_date ? formatDate(t.transaction_date) : "—"}{t.status && t.status !== "completed" ? ` · ${t.status}` : ""}</p>
              </div>
              <p className={cn("num text-[12.5px] flex-shrink-0", t.type === "credit" ? "text-emerald-600" : "text-foreground")}>{amt(Number(t.amount_base ?? t.amount), t.type === "credit")}</p>
            </div>
          );
        }
        const isOpen = expanded.has(g.key);
        return (
          <div key={g.key} className="border-b border-border/40">
            <button
              type="button"
              onClick={() => toggle(g.key)}
              className="w-full px-4 py-2 flex items-center gap-2.5 text-left hover:bg-muted/40 transition-colors"
            >
              <ChevronRight className={cn("h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] text-foreground truncate">{g.name}</p>
                <p className="text-[11px] text-muted-foreground">{g.count} transactions</p>
              </div>
              <p className={cn("num text-[12.5px] font-medium flex-shrink-0", g.amount > 0 ? "text-emerald-600" : "text-foreground")}>{amt(g.amount, g.amount > 0)}</p>
            </button>
            {isOpen && (
              <div className="bg-muted/20">
                {g.txns.map((t) => (
                  <div key={t.id} className="pl-11 pr-4 py-1.5 flex items-center gap-3 border-t border-border/30">
                    <p className="text-[11.5px] text-muted-foreground flex-1">{t.transaction_date ? formatDate(t.transaction_date) : "—"}{t.status && t.status !== "completed" ? ` · ${t.status}` : ""}</p>
                    <p className={cn("num text-[12px] flex-shrink-0", t.type === "credit" ? "text-emerald-600" : "text-foreground")}>{amt(Number(t.amount_base ?? t.amount), t.type === "credit")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!loading && truncated && (
        <p className="p-4 text-center text-[11px] text-muted-foreground">Showing the first 20,000 transactions.</p>
      )}
    </FloatingPanel>
  );
}

export function BankClient({ data, hasBankConnector }: { data: BankOverview; hasBankConnector: boolean }) {
  const router = useRouter();
  const { navigate } = useNavProgress();
  const { totals, categories, byCategory, runway, accountTypes, cards, reviewCount } = data;
  const [qInput, setQInput] = useState(""); // immediate input value
  const [q, setQ] = useState("");           // debounced term used for fetching
  const [filter, setFilter] = useState<Filter>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "pending" | "failed" | "refunded">("all");
  const [accountFilter, setAccountFilter] = useState<string>("all");
  const [cardFilter, setCardFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  // ── Multi-select + bulk categorize ──────────────────────────────────────────
  // Selection is a Set of ids that PERSISTS across pages (so you can page through
  // and keep adding), but is cleared whenever the filter set changes (below), since
  // those ids may no longer be in view.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSlug, setBulkSlug] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);

  // Server-driven transaction table: the page ships only aggregates (a few KB); the
  // rows are fetched here one bounded page at a time, so the ledger can grow without
  // limit. Debounce the search so typing doesn't fire a request per keystroke.
  const [rows, setRows] = useState<BankTxn[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingRows, setLoadingRows] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const fetchRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const params = new URLSearchParams({
        from: data.period.from, to: data.period.to,
        view: filter, status: statusFilter, account: accountFilter, card: cardFilter,
        search: q, page: String(page), pageSize: String(PAGE),
      });
      const res = await fetch(`/api/bank/transactions?${params.toString()}`);
      const j = await res.json();
      if (res.ok) { setRows(j.rows ?? []); setTotal(j.total ?? 0); }
      else setMsg(j.error ?? "Failed to load transactions");
    } catch {
      setMsg("Failed to load transactions");
    } finally {
      setLoadingRows(false);
    }
  }, [data.period.from, data.period.to, filter, statusFilter, accountFilter, cardFilter, q, page]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const [savingId, setSavingId] = useState<string | null>(null);
  const [categorizing, startCategorize] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  // Category drill drawer (click an "Expenses by category" row → its transactions).
  const [catDrill, setCatDrill] = useState<{ slug: string; label: string; amount: number; count: number } | null>(null);

  // Inline field editor (date / counterparty / description / amount / type).
  const [editRow, setEditRow] = useState<BankTxn | null>(null);
  const [editForm, setEditForm] = useState<{ transaction_date: string; counterparty_name: string; description: string; amount: string; type: "credit" | "debit" }>(
    { transaction_date: "", counterparty_name: "", description: "", amount: "", type: "debit" }
  );
  const [savingEdit, setSavingEdit] = useState(false);

  // Split editor: divide one bank txn into N parts that total the original exactly.
  const [splitRow, setSplitRow] = useState<BankTxn | null>(null);
  const [splitParts, setSplitParts] = useState<{ amount: string; category: string }[]>([]);
  const [savingSplit, setSavingSplit] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [unsplittingId, setUnsplittingId] = useState<string | null>(null);

  function openEdit(t: BankTxn) {
    setEditRow(t);
    setEditForm({
      transaction_date: t.transaction_date?.slice(0, 10) ?? "",
      counterparty_name: t.counterparty_name ?? "",
      description: t.description ?? "",
      amount: String(t.amount ?? ""),
      type: t.type,
    });
  }

  async function saveEdit() {
    if (!editRow) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/transactions/${editRow.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_date: editForm.transaction_date,
          counterparty_name: editForm.counterparty_name,
          description: editForm.description,
          amount: editForm.amount === "" ? undefined : Number(editForm.amount),
          type: editForm.type,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to save");
      setEditRow(null);
      await fetchRows();
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  }

  function openSplit(t: BankTxn) {
    setSplitRow(t);
    setSplitError(null);
    setSplitParts([{ amount: "", category: "" }, { amount: "", category: "" }]);
  }

  async function saveSplit() {
    if (!splitRow) return;
    setSavingSplit(true);
    setSplitError(null);
    try {
      const res = await fetch("/api/bank/split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: splitRow.id,
          parts: splitParts.map((p) => ({ amount: Number(p.amount), category: p.category })),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        // Surface the reason INSIDE the modal (a top-of-page banner would be hidden
        // behind it). If the row was already split (e.g. a stale list still shows the
        // parent), refresh so it disappears and the parts show.
        setSplitError(j.error ?? "Failed to split");
        if (typeof j.error === "string" && /already split/i.test(j.error)) { await fetchRows(); router.refresh(); }
        return;
      }
      setSplitRow(null);
      await fetchRows();
      router.refresh();
      setMsg(`Split into ${j.parts} parts.`);
    } catch (e) {
      setSplitError(e instanceof Error ? e.message : "Failed to split");
    } finally {
      setSavingSplit(false);
    }
  }

  async function unsplit(t: BankTxn) {
    setUnsplittingId(t.id);
    try {
      const res = await fetch("/api/bank/unsplit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: t.split_parent_id ?? t.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to unsplit");
      await fetchRows();
      router.refresh();
      setMsg("Split removed — original restored.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to unsplit");
    } finally {
      setUnsplittingId(null);
    }
  }

  // Category options grouped by P&L treatment for the inline picker.
  const grouped = useMemo(() => {
    const g: Record<string, LedgerCategory[]> = { expense: [], income: [], excluded: [], uncategorized: [] };
    for (const c of categories) (g[c.treatment] ??= []).push(c);
    return g;
  }, [categories]);

  const needsReview = (t: BankTxn) =>
    !t.pnl_treatment || t.pnl_treatment === "uncategorized" ||
    (t.category_source === "ai" && (t.category_confidence ?? 1) < 0.6);

  // Rows are the server page; pagination is driven by the server total.
  const pageRows = rows;
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const visibleIds = pageRows.map((t) => t.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someVisibleSelected = visibleIds.some((id) => selected.has(id));

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
      await fetchRows();   // refresh the visible page
      router.refresh();    // refresh the aggregates (cards/charts/totals)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to categorize");
    } finally {
      setSavingId(null);
    }
  }

  // Reset the selection whenever the filter/search/date range changes — the
  // previously-selected ids may no longer match what's shown. (Page changes do NOT
  // clear it, so cross-page selection is preserved.)
  useEffect(() => {
    setSelected(new Set());
    setBulkSlug("");
  }, [q, filter, statusFilter, accountFilter, cardFilter, data.period.from, data.period.to]);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleVisible(visibleIds: string[], allSelected: boolean) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (allSelected) visibleIds.forEach((id) => n.delete(id));
      else visibleIds.forEach((id) => n.add(id));
      return n;
    });
  }

  // Extend the selection to EVERY row matching the current filter (not just the
  // visible page), fetched as a small id-only list so it scales past the page size.
  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const params = new URLSearchParams({
        from: data.period.from, to: data.period.to,
        view: filter, status: statusFilter, account: accountFilter, card: cardFilter, search: q,
      });
      const res = await fetch(`/api/bank/transaction-ids?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to select all");
      setSelected(new Set<string>(j.ids ?? []));
      if (j.capped) setMsg(`Selected the first ${Number(j.cap).toLocaleString("en-IN")} matching transactions — the filter matched more, so narrow it to reach the rest.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to select all");
    } finally {
      setSelectingAll(false);
    }
  }

  // Apply one category to every selected transaction in a single request. remember
  // is false: a hand-picked batch spans arbitrary counterparties, so we touch ONLY
  // the rows the user selected (no counterparty rule / no propagation). Accepts an
  // explicit slug so it can be driven either from the bulk bar OR from changing the
  // category on any selected row's own dropdown (the natural gesture).
  async function applyBulk(slugArg?: string) {
    const slug = slugArg ?? bulkSlug;
    if (!slug || selected.size === 0) return;
    setBulkSaving(true);
    try {
      const res = await fetch("/api/expenses/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], slug, remember: false }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed");
      const label = categories.find((c) => c.slug === slug)?.label ?? slug;
      setMsg(`Categorized ${Number(j.assigned ?? selected.size).toLocaleString("en-IN")} transaction(s) as “${label}”.`);
      setSelected(new Set());
      setBulkSlug("");
      await fetchRows();   // refresh the visible page
      router.refresh();    // refresh the aggregates (cards/charts/totals)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to categorize");
    } finally {
      setBulkSaving(false);
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
  if (!hasBankConnector && totals.txnCount === 0) {
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
  const catTotal = byCategory.reduce((a, c) => a + c.amount, 0);
  // reviewCount comes from the server aggregate (computed over ALL rows in range),
  // matching the row badge + "Needs review" filter.

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
        <MetricCard title="Net P&L" value={inr(totals.net, true)} icon={totals.net >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />} accentColor={totals.net >= 0 ? "#10b981" : "#f43f5e"} subtitle="Collections + other income − expenses (ties to P&L)" />
        <MetricCard title="Collections" value={inr(totals.collections, true)} icon={<ArrowUpRight className="size-4" />} subtitle="Revenue (PG + sales), net of refunds & gateway fees" />
        <MetricCard title="Expenses" value={inr(totals.expenses, true)} icon={<ArrowDownRight className="size-4" />} accentColor="#f59e0b" subtitle="Categorized bank outflows" />
        <MetricCard title="Other income" value={inr(totals.otherIncome, true)} icon={<ArrowUpRight className="size-4" />} accentColor="#10b981" subtitle="Non-PG receipts (invoices, interest)" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-enter-1">
        <MetricCard title="Cash balance" value={inr(runway.cashBalance, true)} icon={<Wallet className="size-4" />} subtitle="Approx. (Mercury + PG net)" />
        <MetricCard title="Monthly burn" value={inr(runway.burnRate, true)} icon={<TrendingDown className="size-4" />} subtitle="Avg last 90 days" />
        <MetricCard title="Runway" value={runwayLabel(runway.runwayDays)} icon={<Wallet className="size-4" />} severity={runway.runwayDays <= 120 ? "warning" : undefined} subtitle="Cash ÷ burn" />
        <MetricCard title="Needs review" value={reviewCount.toLocaleString("en-IN")} icon={<AlertTriangle className="size-4" />} severity={reviewCount > 0 ? "warning" : undefined} subtitle="Uncategorized or low-confidence (all statuses)" />
      </div>

      {/* Expenses by category — clean ranked list, click a row to drill into its transactions */}
      <SectionCard title="Expenses by category" subtitle={`${byCategory.length} categories · ${inr(catTotal, true)} in range · click any row for its transactions`} className="animate-enter-1">
        {byCategory.length === 0 ? (
          <p className="text-xs text-muted-foreground py-6 text-center">No categorized expenses yet — run auto-categorize or classify transactions below.</p>
        ) : (
          <div className="-mx-1.5 max-h-[420px] overflow-auto">
            {byCategory.map((c, i) => {
              const share = catTotal ? (c.amount / catTotal) * 100 : 0;
              return (
                <button
                  key={c.category}
                  onClick={() => setCatDrill({ slug: c.category, label: c.label, amount: c.amount, count: c.count })}
                  className="group w-full flex items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-muted/60 transition-colors"
                >
                  <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/40">{i + 1}</span>
                  <span className="w-48 shrink-0 truncate text-[13px] font-medium text-foreground">{c.label}</span>
                  <div className="flex-1 min-w-[40px] h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-amber-500/70" style={{ width: `${(c.amount / maxCat) * 100}%` }} />
                  </div>
                  <span className="w-28 shrink-0 text-right tabular-nums text-[13px] font-semibold text-foreground">{inr(c.amount, true)}</span>
                  <span className="w-11 shrink-0 text-right tabular-nums text-[11.5px] text-muted-foreground">{share.toFixed(0)}%</span>
                  <span className="w-16 shrink-0 text-right tabular-nums text-[11px] text-muted-foreground/60">{c.count} txns</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/25 group-hover:text-muted-foreground transition-colors" />
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Transactions */}
      <SectionCard
        title="Transactions"
        subtitle={`${total.toLocaleString("en-IN")} match${loadingRows ? " · loading…" : ""}`}
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1">
              <Search className="size-3.5 text-muted-foreground" />
              <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Search counterparty, memo…" className="bg-transparent text-xs outline-none w-40" />
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
        {/* Bulk action bar — appears once anything is selected. Set one category
            for the whole selection in a single action. */}
        {selected.size > 0 && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex flex-wrap items-center gap-2.5 rounded-xl border border-primary/40 bg-card px-4 py-2.5 shadow-2xl shadow-black/20 animate-enter">
            <span className="text-xs font-semibold text-primary">{selected.size.toLocaleString("en-IN")} selected</span>
            {total > visibleIds.length && selected.size < total && (
              <button
                onClick={selectAllMatching}
                disabled={selectingAll}
                className="text-[11px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
              >
                {selectingAll ? "Selecting…" : `Select all ${total.toLocaleString("en-IN")} matching`}
              </button>
            )}
            <div className="h-4 w-px bg-border" />
            <select
              value={bulkSlug}
              onChange={(e) => { const v = e.target.value; setBulkSlug(v); if (v) applyBulk(v); }}
              disabled={bulkSaving}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none max-w-[200px] disabled:opacity-50"
            >
              <option value="" disabled>{bulkSaving ? "Applying…" : "Set category for all…"}</option>
              {(["expense", "income", "excluded"] as const).map((grp) => (
                <optgroup key={grp} label={grp[0].toUpperCase() + grp.slice(1)}>
                  {(grouped[grp] ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                </optgroup>
              ))}
            </select>
            <button
              onClick={() => { setSelected(new Set()); setBulkSlug(""); }}
              disabled={bulkSaving}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium hover:border-border/60 disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground border-b border-border/50">
              <th className="py-1.5 font-medium w-8">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  className="size-3.5 cursor-pointer align-middle accent-[hsl(var(--primary))]"
                  checked={allVisibleSelected}
                  ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                  onChange={() => toggleVisible(visibleIds, allVisibleSelected)}
                />
              </th>
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
              <th className="font-medium"></th>
            </tr></thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={14} className="py-8 text-center text-muted-foreground">{loadingRows ? "Loading…" : "No transactions match."}</td></tr>
              ) : pageRows.map((t) => (
                <tr key={t.id} className={cn("border-b border-border/30", selected.has(t.id) ? "bg-primary/[0.06]" : needsReview(t) && "bg-rose-500/[0.03]")}>
                  <td className="py-1.5">
                    <input
                      type="checkbox"
                      aria-label="Select transaction"
                      className="size-3.5 cursor-pointer align-middle accent-[hsl(var(--primary))]"
                      checked={selected.has(t.id)}
                      onChange={() => toggleOne(t.id)}
                    />
                  </td>
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
                      disabled={savingId === t.id || bulkSaving}
                      onChange={(e) => {
                        // If this row is part of a multi-selection, changing its
                        // category applies to the WHOLE selection (the natural
                        // gesture). Otherwise it's a single-row edit (remembers
                        // the vendor rule, as before).
                        if (selected.size > 1 && selected.has(t.id)) applyBulk(e.target.value);
                        else assign(t.id, e.target.value);
                      }}
                      className={cn("rounded-md border bg-background px-1.5 py-0.5 text-xs outline-none max-w-[160px] disabled:opacity-50", selected.size > 1 && selected.has(t.id) ? "border-primary/50" : "border-border")}
                    >
                      <option value="" disabled>{savingId === t.id ? "Saving…" : bulkSaving && selected.has(t.id) ? "Applying…" : selected.size > 1 && selected.has(t.id) ? `Set for ${selected.size} selected…` : "Uncategorized"}</option>
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
                  <td className="text-right whitespace-nowrap">
                    {t.split_parent_id ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="rounded bg-violet-500/10 text-violet-600 px-1.5 py-0.5 text-[10px] font-medium">part</span>
                        <button
                          onClick={() => unsplit(t)}
                          disabled={unsplittingId === t.id}
                          title="Undo split — restores the original transaction"
                          className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent disabled:opacity-40"
                        >
                          <Undo2 className="size-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5">
                        <button
                          onClick={() => openSplit(t)}
                          title="Split into parts"
                          className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent"
                        >
                          <Scissors className="size-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(t)}
                          title="Edit fields"
                          className="p-1 rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent"
                        >
                          <Pencil className="size-3.5" />
                        </button>
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
            <span>{total.toLocaleString("en-IN")} rows · page {page + 1} of {pageCount}</span>
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

      {/* Inline field editor — edits are marked manual so a sheet re-sync won't overwrite them. */}
      <Dialog.Root open={editRow != null} onOpenChange={(o) => !o && setEditRow(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[150]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[440px] bg-card border border-border rounded-xl z-[151] shadow-2xl focus:outline-none">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <Dialog.Title className="text-sm font-semibold text-foreground">Edit transaction</Dialog.Title>
              <Dialog.Close className="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center"><X className="h-4 w-4" /></Dialog.Close>
            </div>
            <div className="p-4 space-y-3">
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Date</span>
                <input type="date" value={editForm.transaction_date} onChange={(e) => setEditForm((f) => ({ ...f, transaction_date: e.target.value }))}
                  className="mt-1 w-full h-9 px-2 rounded-lg border border-border bg-background text-[13px]" />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Counterparty</span>
                <input value={editForm.counterparty_name} onChange={(e) => setEditForm((f) => ({ ...f, counterparty_name: e.target.value }))}
                  placeholder="—" className="mt-1 w-full h-9 px-2 rounded-lg border border-border bg-background text-[13px]" />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Description</span>
                <input value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="—" className="mt-1 w-full h-9 px-2 rounded-lg border border-border bg-background text-[13px]" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">Amount</span>
                  <input type="number" step="0.01" value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                    className="mt-1 w-full h-9 px-2 rounded-lg border border-border bg-background text-[13px] num" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-muted-foreground">Direction</span>
                  <select value={editForm.type} onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as "credit" | "debit" }))}
                    className="mt-1 w-full h-9 px-2 rounded-lg border border-border bg-background text-[13px]">
                    <option value="debit">Debit (out)</option>
                    <option value="credit">Credit (in)</option>
                  </select>
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground/70">Set the category from the row after saving. Manual edits are kept even when the sheet re-syncs.</p>
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-border">
              <Dialog.Close className="flex-1 h-9 rounded-lg border border-border text-[13px] font-medium hover:bg-muted">Cancel</Dialog.Close>
              <button onClick={saveEdit} disabled={savingEdit} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-60">
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Split editor */}
      <Dialog.Root open={splitRow != null} onOpenChange={(o) => !o && setSplitRow(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[150]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[520px] bg-card border border-border rounded-xl z-[151] shadow-2xl focus:outline-none">
            {splitRow && (() => {
              const original = Math.round(Number(splitRow.amount) * 100) / 100;
              const sum = Math.round(splitParts.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;
              const remaining = Math.round((original - sum) * 100) / 100;
              const allValid = splitParts.length >= 2 && splitParts.every((p) => Number(p.amount) > 0 && p.category) && remaining === 0;
              return (
                <>
                  <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                    <div className="min-w-0">
                      <h3 className="text-[14px] font-semibold">Split transaction</h3>
                      <p className="text-[11px] text-muted-foreground truncate">{splitRow.counterparty_name ?? splitRow.description ?? "—"} · {splitRow.currency} {original.toLocaleString("en-IN")}</p>
                    </div>
                    <Dialog.Close className="p-1 rounded hover:bg-accent flex-shrink-0"><X className="size-4" /></Dialog.Close>
                  </div>
                  <div className="p-5 space-y-2 max-h-[52vh] overflow-auto">
                    {splitParts.map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="number" inputMode="decimal" value={p.amount} placeholder="Amount"
                          onChange={(e) => setSplitParts((a) => a.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                          className="w-28 h-9 px-2 rounded-lg border border-border bg-background text-[13px] tabular-nums outline-none focus:border-primary"
                        />
                        <select
                          value={p.category}
                          onChange={(e) => setSplitParts((a) => a.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}
                          className="flex-1 h-9 rounded-lg border border-border bg-background px-2 text-[13px] outline-none focus:border-primary"
                        >
                          <option value="" disabled>Select category…</option>
                          {(["expense", "income", "excluded"] as const).map((grp) => (
                            <optgroup key={grp} label={grp[0].toUpperCase() + grp.slice(1)}>
                              {(grouped[grp] ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <button
                          onClick={() => setSplitParts((a) => (a.length > 2 ? a.filter((_, j) => j !== i) : a))}
                          disabled={splitParts.length <= 2} title="Remove part"
                          className="p-1.5 rounded text-muted-foreground/60 hover:text-destructive disabled:opacity-30"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setSplitParts((a) => (a.length < 10 ? [...a, { amount: "", category: "" }] : a))}
                      disabled={splitParts.length >= 10}
                      className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline disabled:opacity-40"
                    >
                      <Plus className="size-3.5" /> Add part
                    </button>
                  </div>
                  <div className="px-5 py-3 border-t border-border space-y-2">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">Remaining to allocate</span>
                      <span className={cn("tabular-nums font-medium", remaining === 0 ? "text-emerald-600" : remaining < 0 ? "text-destructive" : "text-foreground")}>
                        {splitRow.currency} {remaining.toLocaleString("en-IN")}
                      </span>
                    </div>
                    {splitError && (
                      <p className="rounded-lg bg-destructive/10 text-destructive px-3 py-2 text-[12px]">{splitError}</p>
                    )}
                    <div className="flex gap-2">
                      <Dialog.Close className="flex-1 h-9 rounded-lg border border-border text-[13px] hover:bg-accent">Cancel</Dialog.Close>
                      <button onClick={saveSplit} disabled={!allValid || savingSplit} className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-[13px] font-medium hover:bg-primary/90 disabled:opacity-50">
                        {savingSplit ? "Splitting…" : "Split"}
                      </button>
                    </div>
                    {remaining !== 0 && <p className="text-[11px] text-muted-foreground/70">Parts must total exactly {splitRow.currency} {original.toLocaleString("en-IN")} (over/under is not allowed).</p>}
                  </div>
                </>
              );
            })()}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Category drill drawer */}
      <CategoryDrillDrawer drill={catDrill} onClose={() => setCatDrill(null)} from={data.period.from} to={data.period.to} />
    </div>
  );
}
