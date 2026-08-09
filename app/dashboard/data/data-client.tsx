"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Search,
  Download,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowUpDown,
  Copy,
  Check,
  ScanSearch,
  X,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { parsePaymentText, type ParsedPayment } from "@/lib/ocr/parse";

// ─── Client-side OCR (no AI) ─────────────────────────────────────────────────
// Reads a payment screenshot entirely in the browser with Tesseract.js (lazy-
// loaded on first use), lightly preprocessing for legibility. Returns raw text.
async function ocrImage(file: File, onProgress?: (p: number) => void): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read the file"));
    r.readAsDataURL(file);
  });
  const img = document.createElement("img");
  img.src = dataUrl;
  await img.decode();

  // Upscale small images (helps OCR) but don't blow up large ones; then grayscale.
  const longEdge = Math.max(img.width, img.height) || 1;
  const scale = Math.min(2, Math.max(1, 1600 / longEdge));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(id, 0, 0);

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) onProgress(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text ?? "";
  } finally {
    await worker.terminate();
  }
}

function toExtracted(p: ParsedPayment): ImageExtracted {
  return {
    amount: p.amount, currency: p.currency, date: p.date, datetime: null,
    ids: p.tokens, upi_ref: null, upi_id: null, email: null, phone: null,
    counterparty_name: null, method: p.method, summary: null,
  };
}

// ─── Screenshot-search result shapes (mirror /api/transactions/search-by-image) ──
type ImageExtracted = {
  amount: number | null; currency: string | null; date: string | null; datetime: string | null;
  ids: string[]; upi_ref: string | null; upi_id: string | null; email: string | null;
  phone: string | null; counterparty_name: string | null; method: string | null; summary: string | null;
};
type ImageMatch = {
  id: string; transaction_date: string; source: string; type: "credit" | "debit"; amount: number;
  currency: string; status: string; counterparty_name: string | null; description: string | null;
  external_id: string | null; confidence: "high" | "medium" | "low"; matched_on: string; amount_matches: boolean;
};
type ImageSearchResult = { extracted: ImageExtracted; tokens: string[]; matches: ImageMatch[]; note: string | null };
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { categorizeSource, sourceLabel, type SourceBucket } from "@/lib/finance/transaction-status";

// Inline value + one-click copy. Shows the full value (no truncation) with a copy
// icon that reveals on hover and flips to a tick for ~1.2s after copying.
function CopyValue({
  value,
  copyValue,
  className,
}: {
  value: string;
  copyValue?: string; // what lands on the clipboard, if different from the displayed value
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const copy = React.useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(copyValue ?? value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch {
        /* clipboard unavailable (e.g. insecure context) — ignore */
      }
    },
    [value, copyValue]
  );
  return (
    <span className={cn("group/copy inline-flex items-center gap-1.5", className)}>
      <span className="whitespace-nowrap">{value}</span>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied!" : "Copy"}
        aria-label={`Copy ${value}`}
        className="shrink-0 opacity-0 group-hover/copy:opacity-100 focus:opacity-100 transition-opacity text-muted-foreground/60 hover:text-primary"
      >
        {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      </button>
    </span>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectorSummary {
  id: string;
  name: string;
  type: string;
}

interface TxRow {
  id: string;
  transaction_date: string;
  transaction_at: string | null;
  source: string;
  type: "credit" | "debit";
  amount: number;
  currency: string;
  amount_base: number | null;
  base_currency: string | null;
  fx_rate: number | null;
  status: string;
  counterparty_name: string | null;
  description: string | null;
  external_id: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
  connector_id: string;
  // joined
  connectors?: { name: string; type: string } | null;
}

interface ApiResponse {
  rows: TxRow[];
  total: number;
  limit: number;
  offset: number;
}

interface SummaryResponse {
  // Server-computed card totals (see the locked spec in summary/route.ts):
  // Payments = completed+refunded, Settlements/Refunds = completed only,
  // Disputes = all disputes raised. Pending counts toward none of them.
  cards: {
    payments:    { count: number; amount: number };
    settlements: { count: number; amount: number };
    refunds:     { count: number; amount: number };
    disputes:    { count: number; amount: number };
  };
  groups: Record<string, { count: number; amount: number }>; // source-filter dropdown only
  totalCredits: number;
  totalDebits: number;
  totalFees: number;
  net: number;
  total: number;
}

// ─── Source badge colours ─────────────────────────────────────────────────────

// Theme-adaptive: darker text in light mode, lighter in dark — legible on both.
const SOURCE_COLOURS: Record<string, string> = {
  razorpay:            "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  razorpay_refund:     "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20",
  razorpay_settlement: "bg-primary/10 text-primary border-primary/20",
  razorpay_dispute:    "bg-red-500/10 text-destructive border-red-500/20",
  razorpay_payout:     "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/20",
  stripe:              "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20",
  stripe_payout:       "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20",
  stripe_dispute:      "bg-red-500/10 text-destructive border-red-500/20",
  csv:                 "bg-accent/40 text-muted-foreground border-border",
};

const SOURCE_LABELS: Record<string, string> = {
  razorpay:            "RZP Payment",
  razorpay_refund:     "RZP Refund",
  razorpay_settlement: "RZP Settlement",
  razorpay_dispute:    "RZP Dispute",
  razorpay_payout:     "RZP Payout",
  stripe:              "Stripe Charge",
  stripe_payout:       "Stripe Payout",
  stripe_dispute:      "Stripe Dispute",
  csv:                 "CSV",
};

// Generic per-bucket badge colour — fallback for ANY source not in SOURCE_COLOURS
// (so a new connector's badges are coloured sensibly with no per-gateway edit).
const BUCKET_COLOURS: Record<SourceBucket, string> = {
  payment:    "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20",
  refund:     "bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20",
  settlement: "bg-primary/10 text-primary border-primary/20",
  dispute:    "bg-red-500/10 text-destructive border-red-500/20",
  adjustment: "bg-accent/40 text-muted-foreground border-border",
};

const STATUS_COLOURS: Record<string, string> = {
  completed: "text-success",
  pending:   "text-warning",
  failed:    "text-destructive",
  refunded:  "text-orange-600 dark:text-orange-400",
};

const PAGE_SIZE = 50;

// IST (Asia/Kolkata) calendar date, N days ago, as YYYY-MM-DD. Used for the
// default filter so the page lands on the last 7 days.
const istDate = (daysAgo = 0) =>
  new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

// ─── Props ────────────────────────────────────────────────────────────────────

interface DataExplorerClientProps {
  orgId: string;
  connectors: ConnectorSummary[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DataExplorerClient({ orgId, connectors }: DataExplorerClientProps) {
  // Filters
  const [connectorId, setConnectorId] = React.useState("");
  const [source, setSource] = React.useState("");
  const [txType, setTxType] = React.useState("");
  // Default to the last 7 days (today + 6 prior, IST). Cleared → all dates.
  const [from, setFrom] = React.useState(() => istDate(6));
  const [to, setTo] = React.useState(() => istDate(0));
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  // Pagination + sort
  const [offset, setOffset] = React.useState(0);
  const [sortCol, setSortCol] = React.useState("transaction_date");
  const [sortAsc, setSortAsc] = React.useState(false);

  // Data
  const [rows, setRows] = React.useState<TxRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [summary, setSummary] = React.useState<SummaryResponse | null>(null);

  // Screenshot search: upload an image of a payment (UPI app / bank SMS / receipt),
  // Claude reads its identifiers and we match them against transactions.
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [imgOpen, setImgOpen] = React.useState(false);
  const [imgLoading, setImgLoading] = React.useState(false);
  const [ocrProgress, setOcrProgress] = React.useState(0);
  const [imgError, setImgError] = React.useState<string | null>(null);
  const [imgResult, setImgResult] = React.useState<ImageSearchResult | null>(null);

  const handleScreenshot = React.useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { setImgError("Please choose an image file."); setImgOpen(true); return; }
    setImgOpen(true); setImgError(null); setImgResult(null); setImgLoading(true); setOcrProgress(0);
    try {
      // 1) Read the screenshot in the browser (no AI, no API key).
      const text = await ocrImage(file, setOcrProgress);
      // 2) Pull identifiers out with regex.
      const parsed = parsePaymentText(text);
      if (parsed.tokens.length === 0) {
        setImgResult({
          extracted: toExtracted(parsed), tokens: [], matches: [],
          note: "Couldn't read any reference / UPI / order ID from that screenshot. Try a clearer image that shows the transaction, UTR, or reference number.",
        });
        return;
      }
      // 3) Match on identifiers server-side (amount/date only raise confidence).
      const res = await fetch("/api/transactions/search-by-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId, tokens: parsed.tokens, amount: parsed.amount, date: parsed.date }),
      });
      const data = await res.json();
      if (!res.ok) { setImgError(data?.error ?? "Something went wrong searching for matches."); }
      else { setImgResult({ extracted: toExtracted(parsed), tokens: parsed.tokens, matches: data.matches ?? [], note: data.note ?? null }); }
    } catch (e) {
      setImgError(e instanceof Error ? e.message : "Something went wrong reading the screenshot.");
    } finally {
      setImgLoading(false);
    }
  }, [orgId]);

  // Jump to a matched transaction: search by its ID and widen the date range so
  // it shows in the table regardless of the current window.
  const jumpToMatch = React.useCallback((m: ImageMatch) => {
    setSearch(m.external_id || m.matched_on || "");
    setFrom(istDate(3650)); // ~10 years back — matches can be from any date
    setTo(istDate(0));
    setImgOpen(false);
  }, []);

  // Card totals come straight from the server (summary.cards) per the locked spec
  // in summary/route.ts — pending counts toward none of them.

  // Source filter options derived from the sources actually present — new connectors
  // appear automatically, no hardcoded per-gateway list.
  const sourceOptions = React.useMemo(() => {
    const keys = summary ? Object.keys(summary.groups).sort() : [];
    return [{ value: "", label: "All sources" }, ...keys.map((k) => ({ value: k, label: sourceLabel(k) }))];
  }, [summary]);

  // Expanded metadata rows
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  // Debounce search
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset offset when filters change
  React.useEffect(() => {
    setOffset(0);
  }, [connectorId, source, txType, from, to, debouncedSearch, sortCol, sortAsc]);

  // Build shared filter params (used by both table + summary fetches)
  const buildFilterParams = React.useCallback(() => {
    const params = new URLSearchParams({ org_id: orgId });
    if (connectorId)     params.set("connector_id", connectorId);
    if (source)          params.set("source", source);
    if (txType)          params.set("type", txType);
    if (from)            params.set("from", from);
    if (to)              params.set("to", to);
    if (debouncedSearch) params.set("search", debouncedSearch);
    return params;
  }, [orgId, connectorId, source, txType, from, to, debouncedSearch]);

  // Latest-wins guards: a new fetch aborts the previous in-flight one so a slow
  // earlier response can never overwrite a newer one (the stale-card race), and
  // redundant requests are cancelled (no lag under rapid filter changes).
  const dataAbort = React.useRef<AbortController | null>(null);
  const summaryAbort = React.useRef<AbortController | null>(null);
  const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

  // Fetch table rows
  const fetchData = React.useCallback(async () => {
    dataAbort.current?.abort();
    const ctrl = new AbortController();
    dataAbort.current = ctrl;
    setLoading(true);
    try {
      const params = buildFilterParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      params.set("sort", sortCol);
      params.set("order", sortAsc ? "asc" : "desc");

      const res = await fetch(`/api/transactions?${params}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(await res.text());
      const data: ApiResponse = await res.json();
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      if (isAbort(e)) return; // superseded by a newer request — ignore
      console.error(e);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [buildFilterParams, offset, sortCol, sortAsc]);

  // Fetch summary cards — re-runs whenever filters change (not pagination/sort)
  const fetchSummary = React.useCallback(async () => {
    summaryAbort.current?.abort();
    const ctrl = new AbortController();
    summaryAbort.current = ctrl;
    try {
      const params = buildFilterParams();
      const res = await fetch(`/api/transactions/summary?${params}`, { signal: ctrl.signal });
      if (!res.ok) return;
      const data: SummaryResponse = await res.json();
      setSummary(data);
    } catch (e) {
      if (isAbort(e)) return; // superseded — keep the newer request's result
      /* non-critical */
    }
  }, [buildFilterParams]);

  React.useEffect(() => { fetchData(); }, [fetchData]);
  React.useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // CSV export
  const handleExport = async () => {
    const params = new URLSearchParams({ org_id: orgId, limit: "500", offset: "0",
      sort: sortCol, order: sortAsc ? "asc" : "desc" });
    if (connectorId) params.set("connector_id", connectorId);
    if (source)      params.set("source", source);
    if (txType)      params.set("type", txType);
    if (from)        params.set("from", from);
    if (to)          params.set("to", to);
    if (debouncedSearch) params.set("search", debouncedSearch);

    const res = await fetch(`/api/transactions?${params}`);
    const data: ApiResponse = await res.json();

    const headers = [
      "Date","Time (IST)","Source","Connector","Type","Amount","Currency",
      "Amount (INR)","FX Rate","Status",
      "Counterparty","Email","Phone","Description","External ID","Category",
      "Fees","Tax","Order ID","Payment ID","UTR","Phase",
    ];
    const csvRows = data.rows.map((r) => {
      const m = r.metadata ?? {};
      return [
        r.transaction_date,
        fmtTime(r.transaction_at),
        r.source,
        r.connectors?.name ?? "",
        r.type,
        r.amount,
        r.currency,
        r.amount_base ?? "",
        r.fx_rate ?? "",
        r.status,
        r.counterparty_name ?? "",
        m.email ?? "",
        m.phone ?? "",
        (r.description ?? "").replace(/,/g, ";"),
        r.external_id ?? "",
        r.category ?? "",
        m.fee ?? m.fees ?? "",
        m.tax ?? "",
        m.order_id ?? "",
        m.payment_id ?? "",
        m.utr ?? "",
        m.phase ?? "",
      ].join(",");
    });

    const blob = new Blob([[headers.join(","), ...csvRows].join("\n")], {
      type: "text/csv",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortAsc((v) => !v);
    else { setSortCol(col); setSortAsc(false); }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  // Transaction time in IST, 24-hour (HH:mm). Null for rows without a captured
  // timestamp (e.g. CSV imports or historical rows not yet backfilled).
  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const fmtAmount = (amount: number, currency: string, type: "credit" | "debit") => {
    const sign = type === "credit" ? "+" : "−";
    const formatted = new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    return `${sign}${currency} ${formatted}`;
  };

  return (
    <div className="space-y-4 max-w-[1400px]">
      {/* Header */}
      <div className="animate-enter">
        <h1 className="text-xl font-bold text-foreground">Raw Transaction Data</h1>
        <p className="text-sm text-muted-foreground/70 mt-0.5">
          Every row synced from your connected sources — all fields visible
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center animate-enter-delay-1">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/70" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, description, counterparty…"
            className="w-full h-9 rounded-lg border border-border bg-accent/40 pl-8 pr-9 text-xs text-muted-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25"
          />
          {/* Search a payment by screenshot */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleScreenshot(f); e.target.value = ""; }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Search a payment by screenshot"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <ScanSearch className="h-4 w-4" />
          </button>
        </div>

        {/* Connector filter */}
        <FilterSelect
          value={connectorId}
          onChange={setConnectorId}
          options={[
            { value: "", label: "All accounts" },
            // Bank (Mercury) has its own dedicated page — never surface it here.
            ...connectors
              .filter((c) => c.type !== "mercury")
              .map((c) => ({ value: c.id, label: c.type === "app_store" ? "Apple Pay" : c.name })),
          ]}
        />

        {/* Source filter — options derived from the sources actually present */}
        <FilterSelect
          value={source}
          onChange={setSource}
          options={sourceOptions}
        />

        {/* Type filter */}
        <FilterSelect
          value={txType}
          onChange={setTxType}
          options={[
            { value: "", label: "Credit + Debit" },
            { value: "credit", label: "Credits only" },
            { value: "debit",  label: "Debits only" },
          ]}
        />

        {/* Date range */}
        <DateRangePicker
          from={from}
          to={to}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(f, t) => { setFrom(f); setTo(t); }}
        />

        {/* Spacer + export */}
        <div className="ml-auto flex items-center gap-2">
          {loading && <RefreshCw className="h-3.5 w-3.5 text-muted-foreground/70 animate-spin" />}
          <span className="text-xs text-muted-foreground/70">
            {total.toLocaleString("en-IN")} rows
          </span>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border border-border bg-accent/40 text-muted-foreground hover:bg-accent hover:text-muted-foreground hover:border-border transition-all"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <SummaryCard
            label="Payments"
            count={summary.cards.payments.count}
            amount={summary.cards.payments.amount}
            colour="text-success"
          />
          <SummaryCard
            label="Settlements"
            count={summary.cards.settlements.count}
            amount={summary.cards.settlements.amount}
            colour="text-primary"
          />
          <SummaryCard
            label="Refunds"
            count={summary.cards.refunds.count}
            amount={summary.cards.refunds.amount}
            colour="text-orange-600 dark:text-orange-400"
          />
          <SummaryCard
            label="Disputes"
            count={summary.cards.disputes.count}
            amount={summary.cards.disputes.amount}
            colour="text-destructive"
          />
          <SummaryCard
            label="Fees Charged"
            count={null}
            amount={summary.totalFees}
            colour="text-warning"
            note="incl. GST"
          />
          <SummaryCard
            label="Net Flow"
            count={null}
            amount={summary.net}
            colour={summary.net >= 0 ? "text-success" : "text-destructive"}
            showSign
          />
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-accent/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-accent/40">
              <Th col="transaction_date" label="Date" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <Th col="transaction_at" label="Time" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <Th col="source" label="Source" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Connector</th>
              <Th col="type" label="Type" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <Th col="amount" label="Amount" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest whitespace-nowrap">INR (₹)</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest whitespace-nowrap">Rate</th>
              <Th col="status" label="Status" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Name</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Email</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest whitespace-nowrap">Phone</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest min-w-[200px]">Description</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">External ID</th>
              <Th col="category" label="Category" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={16} className="px-4 py-12 text-center text-muted-foreground/70 text-sm">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={16} className="px-4 py-12 text-center text-muted-foreground/70 text-sm">
                  No transactions found. Try adjusting the filters or run a sync first.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isExpanded = expanded.has(row.id);
                const meta = row.metadata ?? {};
                const email = meta.email ? String(meta.email) : null;
                const phone = meta.phone ? String(meta.phone) : null;
                // email/phone are promoted to their own columns, so drop them
                // from the metadata expander to avoid duplication.
                const metaKeys = Object.entries(meta).filter(
                  ([k, v]) => v !== null && v !== undefined && v !== "" && k !== "email" && k !== "phone"
                );
                const expandable = metaKeys.length > 0;

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={cn(
                        "border-b border-border transition-colors",
                        isExpanded
                          ? "bg-accent/40"
                          : "hover:bg-accent"
                      )}
                    >
                      {/* Date */}
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">
                        {row.transaction_date}
                      </td>

                      {/* Time (IST, 24h) */}
                      <td className="px-3 py-2.5 text-muted-foreground/70 whitespace-nowrap tabular-nums">
                        {fmtTime(row.transaction_at)}
                      </td>

                      {/* Source badge */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                            SOURCE_COLOURS[row.source] ?? BUCKET_COLOURS[categorizeSource(row.source)]
                          )}
                        >
                          {SOURCE_LABELS[row.source] ?? sourceLabel(row.source)}
                        </span>
                      </td>

                      {/* Connector */}
                      <td className="px-3 py-2.5 text-muted-foreground/70 whitespace-nowrap">
                        {row.connectors?.name ?? "—"}
                      </td>

                      {/* Type */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            "text-[10px] font-semibold uppercase tracking-wide",
                            row.type === "credit" ? "text-success" : "text-destructive"
                          )}
                        >
                          {row.type}
                        </span>
                      </td>

                      {/* Amount (original currency only — clean) */}
                      <td
                        className={cn(
                          "px-3 py-2.5 font-semibold whitespace-nowrap tabular-nums",
                          row.type === "credit" ? "text-success/80" : "text-destructive/80"
                        )}
                      >
                        {fmtAmount(row.amount, row.currency, row.type)}
                      </td>

                      {/* INR value (base currency) */}
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">
                        {row.amount_base != null
                          ? `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(row.amount_base)}`
                          : "—"}
                      </td>

                      {/* FX rate (USD→INR etc.); 1:1 rows show — */}
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground/70">
                        {row.currency !== "INR" && row.fx_rate != null
                          ? Number(row.fx_rate).toFixed(2)
                          : "—"}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={cn("text-[10px] font-medium", STATUS_COLOURS[row.status] ?? "text-muted-foreground/70")}>
                          {row.status}
                        </span>
                      </td>

                      {/* Counterparty — full display + copy (often an email for Razorpay) */}
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {row.counterparty_name ? <CopyValue value={row.counterparty_name} /> : "—"}
                      </td>

                      {/* Email (from metadata) — shown in full, one-click copy */}
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {email ? <CopyValue value={email} /> : "—"}
                      </td>

                      {/* Phone (from metadata) — one-click copy (copies the 10-digit number, no ISD code) */}
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                        {phone ? (
                          <CopyValue
                            value={phone}
                            copyValue={phone.replace(/\D/g, "").slice(-10)}
                            className="tabular-nums"
                          />
                        ) : (
                          "—"
                        )}
                      </td>

                      {/* Description */}
                      <td className="px-3 py-2.5 text-muted-foreground/70 max-w-[220px] truncate">
                        {row.description ?? "—"}
                      </td>

                      {/* External ID */}
                      <td className="px-3 py-2.5 font-mono text-muted-foreground/70 text-[10px] whitespace-nowrap">
                        {row.external_id ?? "—"}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-2.5 text-muted-foreground/70 capitalize whitespace-nowrap">
                        {row.category ?? "—"}
                      </td>

                      {/* Metadata expand */}
                      <td className="px-3 py-2.5">
                        {expandable && (
                          <button
                            onClick={() => toggleExpand(row.id)}
                            className="flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-primary transition-colors"
                          >
                            {metaKeys.length} fields
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded metadata row */}
                    {isExpanded && (
                      <tr className="border-b border-border bg-accent/40">
                        <td colSpan={16} className="px-4 pb-3 pt-2">
                          <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                            {metaKeys.map(([k, v]) => (
                              <div key={k} className="flex items-center gap-2 min-w-[160px]">
                                <span className="text-[10px] font-mono text-muted-foreground/70 uppercase">
                                  {k}
                                </span>
                                <span className="text-[11px] text-muted-foreground font-medium truncate max-w-[200px]">
                                  {typeof v === "object" ? JSON.stringify(v) : String(v)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground/70">
          <span>
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
            {total.toLocaleString("en-IN")}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              disabled={currentPage === 1}
              onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
              className="h-7 w-7 rounded-lg border border-border bg-accent/40 flex items-center justify-center hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 tabular-nums">
              {currentPage} / {totalPages}
            </span>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setOffset((p) => p + PAGE_SIZE)}
              className="h-7 w-7 rounded-lg border border-border bg-accent/40 flex items-center justify-center hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Screenshot search modal ─────────────────────────────────────── */}
      <Dialog.Root open={imgOpen} onOpenChange={setImgOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(560px,94vw)] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background shadow-2xl flex flex-col focus:outline-none">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <ScanSearch className="h-4 w-4 text-primary" />
                <div>
                  <Dialog.Title className="text-[14px] font-semibold text-foreground">Find a payment by screenshot</Dialog.Title>
                  <Dialog.Description className="text-[11.5px] text-muted-foreground">Matches on reference / UPI / order IDs read from the image.</Dialog.Description>
                </div>
              </div>
              <Dialog.Close asChild>
                <button className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"><X className="h-4 w-4" /></button>
              </Dialog.Close>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {imgLoading && (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-[12.5px]">Reading your screenshot{ocrProgress > 0 && ocrProgress < 1 ? ` — ${Math.round(ocrProgress * 100)}%` : "…"}</p>
                  <p className="text-[11px] text-muted-foreground/60">On-device OCR — the image never leaves your browser.</p>
                </div>
              )}

              {imgError && !imgLoading && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[12.5px] text-foreground/80">{imgError}</div>
              )}

              {imgResult && !imgLoading && (
                <>
                  {/* What we read */}
                  <div className="rounded-lg border border-border bg-accent/30 p-3 space-y-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide"><Sparkles className="h-3 w-3 text-primary" /> Read from screenshot</p>
                    {imgResult.extracted.summary && <p className="text-[12.5px] text-foreground/80">{imgResult.extracted.summary}</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {imgResult.extracted.amount != null && (
                        <span className="text-[11px] rounded-md bg-background border border-border px-2 py-0.5 text-foreground">{formatCurrency(imgResult.extracted.amount, imgResult.extracted.currency ?? "INR")}</span>
                      )}
                      {imgResult.extracted.date && <span className="text-[11px] rounded-md bg-background border border-border px-2 py-0.5 text-muted-foreground">{imgResult.extracted.date}</span>}
                      {imgResult.extracted.method && <span className="text-[11px] rounded-md bg-background border border-border px-2 py-0.5 text-muted-foreground">{imgResult.extracted.method}</span>}
                      {imgResult.extracted.counterparty_name && <span className="text-[11px] rounded-md bg-background border border-border px-2 py-0.5 text-muted-foreground truncate max-w-[180px]">{imgResult.extracted.counterparty_name}</span>}
                      {imgResult.tokens.map((t) => (
                        <span key={t} className="num text-[11px] rounded-md bg-primary/10 border border-primary/20 px-2 py-0.5 text-primary truncate max-w-[220px]">{t}</span>
                      ))}
                    </div>
                  </div>

                  {/* Matches */}
                  {imgResult.matches.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{imgResult.matches.length} matching payment{imgResult.matches.length > 1 ? "s" : ""}</p>
                      {imgResult.matches.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => jumpToMatch(m)}
                          className="w-full text-left rounded-lg border border-border bg-card hover:border-primary/40 hover:bg-primary/[0.04] transition-colors px-3 py-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-foreground">{formatCurrency(Number(m.amount), m.currency)}</span>
                            <span className={cn(
                              "text-[9.5px] font-medium uppercase tracking-wide rounded px-1.5 py-0.5 border",
                              m.confidence === "high" ? "text-success border-success/30 bg-success/10"
                                : m.confidence === "medium" ? "text-warning border-warning/30 bg-warning/10"
                                : "text-muted-foreground border-border bg-accent/40"
                            )}>{m.confidence} match</span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                            <span>{formatDate(m.transaction_date)}</span>
                            <span>·</span>
                            <span>{sourceLabel(categorizeSource(m.source))}</span>
                            <span>·</span>
                            <span className="capitalize">{m.status}</span>
                            {m.amount_matches && <><span>·</span><span className="text-success">amount ✓</span></>}
                          </div>
                          {(m.counterparty_name || m.external_id) && (
                            <p className="mt-0.5 num text-[11px] text-muted-foreground/70 truncate">{m.counterparty_name ?? ""}{m.counterparty_name && m.external_id ? " · " : ""}{m.external_id ?? ""}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {imgResult.note && <p className="text-[12px] text-muted-foreground/80 leading-relaxed">{imgResult.note}</p>}
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-border flex-shrink-0">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="h-8 px-3 rounded-lg text-[12px] font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Try another screenshot
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function SummaryCard({
  label,
  count,
  amount,
  colour,
  showSign = false,
  note,
}: {
  label: string;
  count: number | null;
  amount: number;
  colour: string;
  showSign?: boolean;
  note?: string;
}) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(
      Math.abs(n)
    );
  const sign = showSign ? (amount >= 0 ? "+" : "−") : "";

  return (
    <div className="rounded-xl border border-border bg-accent/40 px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-widest">
          {label}
        </p>
        {note && (
          <span className="text-[9px] font-medium text-muted-foreground/70 border border-border rounded px-1 py-px leading-none">
            {note}
          </span>
        )}
      </div>
      {count !== null && (
        <p className="text-[11px] text-muted-foreground/70 mb-0.5">
          {count.toLocaleString("en-IN")} txns
        </p>
      )}
      <p className={cn("text-base font-bold tabular-nums leading-none", colour)}>
        {sign}₹{fmt(amount)}
      </p>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-border bg-accent/40 px-3 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25 appearance-none pr-7"
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-popover text-muted-foreground">
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Th({
  col,
  label,
  sortCol,
  sortAsc,
  onSort,
}: {
  col: string;
  label: string;
  sortCol: string;
  sortAsc: boolean;
  onSort: (col: string) => void;
}) {
  const active = sortCol === col;
  return (
    <th
      className="px-3 py-2.5 text-left cursor-pointer select-none"
      onClick={() => onSort(col)}
    >
      <div className="flex items-center gap-1 group">
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-widest transition-colors",
            active ? "text-primary" : "text-muted-foreground/70 group-hover:text-muted-foreground"
          )}
        >
          {label}
        </span>
        {active ? (
          sortAsc ? (
            <ChevronUp className="h-3 w-3 text-primary" />
          ) : (
            <ChevronDown className="h-3 w-3 text-primary" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/70 group-hover:text-muted-foreground/70" />
        )}
      </div>
    </th>
  );
}
