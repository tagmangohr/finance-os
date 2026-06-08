"use client";

import * as React from "react";
import {
  Search,
  Download,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectorSummary {
  id: string;
  name: string;
  type: string;
}

interface TxRow {
  id: string;
  transaction_date: string;
  source: string;
  type: "credit" | "debit";
  amount: number;
  currency: string;
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
  groups: Record<string, { count: number; amount: number }>;
  totalCredits: number;
  totalDebits: number;
  totalFees: number;
  net: number;
  total: number;
}

// ─── Source badge colours ─────────────────────────────────────────────────────

const SOURCE_COLOURS: Record<string, string> = {
  razorpay:            "bg-blue-500/15 text-blue-300 border-blue-500/20",
  razorpay_refund:     "bg-orange-500/15 text-orange-300 border-orange-500/20",
  razorpay_settlement: "bg-violet-500/15 text-violet-300 border-violet-500/20",
  razorpay_dispute:    "bg-red-500/15 text-red-300 border-red-500/20",
  razorpay_payout:     "bg-pink-500/15 text-pink-300 border-pink-500/20",
  stripe:              "bg-indigo-500/15 text-indigo-300 border-indigo-500/20",
  stripe_payout:       "bg-purple-500/15 text-purple-300 border-purple-500/20",
  csv:                 "bg-white/10 text-white/50 border-white/10",
};

const SOURCE_LABELS: Record<string, string> = {
  razorpay:            "RZP Payment",
  razorpay_refund:     "RZP Refund",
  razorpay_settlement: "RZP Settlement",
  razorpay_dispute:    "RZP Dispute",
  razorpay_payout:     "RZP Payout",
  stripe:              "Stripe Charge",
  stripe_payout:       "Stripe Payout",
  csv:                 "CSV",
};

const STATUS_COLOURS: Record<string, string> = {
  completed: "text-emerald-400",
  pending:   "text-amber-400",
  failed:    "text-red-400",
  refunded:  "text-orange-400",
};

const PAGE_SIZE = 50;

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
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
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

  // Fetch table rows
  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = buildFilterParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      params.set("sort", sortCol);
      params.set("order", sortAsc ? "asc" : "desc");

      const res = await fetch(`/api/transactions?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data: ApiResponse = await res.json();
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [buildFilterParams, offset, sortCol, sortAsc]);

  // Fetch summary cards — re-runs whenever filters change (not pagination/sort)
  const fetchSummary = React.useCallback(async () => {
    try {
      const params = buildFilterParams();
      const res = await fetch(`/api/transactions/summary?${params}`);
      if (!res.ok) return;
      const data: SummaryResponse = await res.json();
      setSummary(data);
    } catch { /* non-critical */ }
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
      "Date","Source","Connector","Type","Amount","Currency","Status",
      "Counterparty","Description","External ID","Category",
      "Fees","Tax","Order ID","Payment ID","UTR","Phase",
    ];
    const csvRows = data.rows.map((r) => {
      const m = r.metadata ?? {};
      return [
        r.transaction_date,
        r.source,
        r.connectors?.name ?? "",
        r.type,
        r.amount,
        r.currency,
        r.status,
        r.counterparty_name ?? "",
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
        <h1 className="text-xl font-bold text-white/85">Raw Transaction Data</h1>
        <p className="text-sm text-white/30 mt-0.5">
          Every row synced from your connected sources — all fields visible
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center animate-enter-delay-1">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/25" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ID, description, counterparty…"
            className="w-full h-9 rounded-lg border border-white/[0.07] bg-white/[0.03] pl-8 pr-3 text-xs text-white/70 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25"
          />
        </div>

        {/* Connector filter */}
        <FilterSelect
          value={connectorId}
          onChange={setConnectorId}
          options={[
            { value: "", label: "All accounts" },
            ...connectors.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />

        {/* Source filter */}
        <FilterSelect
          value={source}
          onChange={setSource}
          options={[
            { value: "", label: "All sources" },
            { value: "razorpay",            label: "RZP Payments" },
            { value: "razorpay_refund",     label: "RZP Refunds" },
            { value: "razorpay_settlement", label: "RZP Settlements" },
            { value: "razorpay_dispute",    label: "RZP Disputes" },
            { value: "stripe",              label: "Stripe Charges" },
            { value: "stripe_payout",       label: "Stripe Payouts" },
            { value: "csv",                 label: "CSV" },
          ]}
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
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-9 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 text-xs text-white/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25 [color-scheme:dark]"
        />
        <span className="text-white/20 text-xs">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-9 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 text-xs text-white/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25 [color-scheme:dark]"
        />

        {/* Spacer + export */}
        <div className="ml-auto flex items-center gap-2">
          {loading && <RefreshCw className="h-3.5 w-3.5 text-white/30 animate-spin" />}
          <span className="text-xs text-white/25">
            {total.toLocaleString("en-IN")} rows
          </span>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium border border-white/[0.08] bg-white/[0.03] text-white/50 hover:bg-white/[0.06] hover:text-white/75 hover:border-white/[0.12] transition-all"
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
            count={(summary.groups["razorpay"]?.count ?? 0) + (summary.groups["stripe"]?.count ?? 0)}
            amount={(summary.groups["razorpay"]?.amount ?? 0) + (summary.groups["stripe"]?.amount ?? 0)}
            colour="text-emerald-400"
          />
          <SummaryCard
            label="Settlements"
            count={(summary.groups["razorpay_settlement"]?.count ?? 0) + (summary.groups["stripe_payout"]?.count ?? 0)}
            amount={(summary.groups["razorpay_settlement"]?.amount ?? 0) + (summary.groups["stripe_payout"]?.amount ?? 0)}
            colour="text-violet-400"
          />
          <SummaryCard
            label="Refunds"
            count={summary.groups["razorpay_refund"]?.count ?? 0}
            amount={summary.groups["razorpay_refund"]?.amount ?? 0}
            colour="text-orange-400"
          />
          <SummaryCard
            label="Disputes"
            count={summary.groups["razorpay_dispute"]?.count ?? 0}
            amount={summary.groups["razorpay_dispute"]?.amount ?? 0}
            colour="text-red-400"
          />
          <SummaryCard
            label="Fees Charged"
            count={null}
            amount={summary.totalFees}
            colour="text-amber-400"
            note="incl. GST"
          />
          <SummaryCard
            label="Net Flow"
            count={null}
            amount={summary.net}
            colour={summary.net >= 0 ? "text-emerald-400" : "text-red-400"}
            showSign
          />
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.01]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <Th col="transaction_date" label="Date" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <Th col="source" label="Source" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-white/30 uppercase tracking-widest">Connector</th>
              <Th col="type" label="Type" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <Th col="amount" label="Amount" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <Th col="status" label="Status" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-white/30 uppercase tracking-widest">Counterparty</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-white/30 uppercase tracking-widest min-w-[200px]">Description</th>
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-white/30 uppercase tracking-widest">External ID</th>
              <Th col="category" label="Category" sortCol={sortCol} sortAsc={sortAsc} onSort={toggleSort} />
              <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-white/30 uppercase tracking-widest">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-white/20 text-sm">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-white/20 text-sm">
                  No transactions found. Try adjusting the filters or run a sync first.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isExpanded = expanded.has(row.id);
                const meta = row.metadata ?? {};
                const metaKeys = Object.entries(meta).filter(
                  ([, v]) => v !== null && v !== undefined && v !== ""
                );

                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={cn(
                        "border-b border-white/[0.04] transition-colors",
                        isExpanded
                          ? "bg-white/[0.04]"
                          : "hover:bg-white/[0.025]"
                      )}
                    >
                      {/* Date */}
                      <td className="px-3 py-2.5 text-white/50 whitespace-nowrap tabular-nums">
                        {row.transaction_date}
                      </td>

                      {/* Source badge */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                            SOURCE_COLOURS[row.source] ?? "bg-white/[0.06] text-white/40 border-white/10"
                          )}
                        >
                          {SOURCE_LABELS[row.source] ?? row.source}
                        </span>
                      </td>

                      {/* Connector */}
                      <td className="px-3 py-2.5 text-white/35 whitespace-nowrap">
                        {row.connectors?.name ?? "—"}
                      </td>

                      {/* Type */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span
                          className={cn(
                            "text-[10px] font-semibold uppercase tracking-wide",
                            row.type === "credit" ? "text-emerald-400" : "text-red-400"
                          )}
                        >
                          {row.type}
                        </span>
                      </td>

                      {/* Amount */}
                      <td
                        className={cn(
                          "px-3 py-2.5 font-semibold whitespace-nowrap tabular-nums",
                          row.type === "credit" ? "text-emerald-400/80" : "text-red-400/80"
                        )}
                      >
                        {fmtAmount(row.amount, row.currency, row.type)}
                      </td>

                      {/* Status */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={cn("text-[10px] font-medium", STATUS_COLOURS[row.status] ?? "text-white/30")}>
                          {row.status}
                        </span>
                      </td>

                      {/* Counterparty */}
                      <td className="px-3 py-2.5 text-white/40 max-w-[140px] truncate">
                        {row.counterparty_name ?? "—"}
                      </td>

                      {/* Description */}
                      <td className="px-3 py-2.5 text-white/35 max-w-[220px] truncate">
                        {row.description ?? "—"}
                      </td>

                      {/* External ID */}
                      <td className="px-3 py-2.5 font-mono text-white/25 text-[10px] whitespace-nowrap">
                        {row.external_id ?? "—"}
                      </td>

                      {/* Category */}
                      <td className="px-3 py-2.5 text-white/30 capitalize whitespace-nowrap">
                        {row.category ?? "—"}
                      </td>

                      {/* Metadata expand */}
                      <td className="px-3 py-2.5">
                        {metaKeys.length > 0 && (
                          <button
                            onClick={() => toggleExpand(row.id)}
                            className="flex items-center gap-1 text-[10px] text-white/25 hover:text-primary transition-colors"
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
                      <tr className="border-b border-white/[0.04] bg-white/[0.03]">
                        <td colSpan={11} className="px-4 pb-3 pt-2">
                          <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                            {metaKeys.map(([k, v]) => (
                              <div key={k} className="flex items-center gap-2 min-w-[160px]">
                                <span className="text-[10px] font-mono text-white/20 uppercase">
                                  {k}
                                </span>
                                <span className="text-[11px] text-white/50 font-medium truncate max-w-[200px]">
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
        <div className="flex items-center justify-between text-xs text-white/30">
          <span>
            Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
            {total.toLocaleString("en-IN")}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              disabled={currentPage === 1}
              onClick={() => setOffset((p) => Math.max(0, p - PAGE_SIZE))}
              className="h-7 w-7 rounded-lg border border-white/[0.07] bg-white/[0.03] flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 tabular-nums">
              {currentPage} / {totalPages}
            </span>
            <button
              disabled={currentPage === totalPages}
              onClick={() => setOffset((p) => p + PAGE_SIZE)}
              className="h-7 w-7 rounded-lg border border-white/[0.07] bg-white/[0.03] flex items-center justify-center hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
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
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <p className="text-[10px] font-semibold text-white/25 uppercase tracking-widest">
          {label}
        </p>
        {note && (
          <span className="text-[9px] font-medium text-white/20 border border-white/10 rounded px-1 py-px leading-none">
            {note}
          </span>
        )}
      </div>
      {count !== null && (
        <p className="text-[11px] text-white/30 mb-0.5">
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
      className="h-9 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 text-xs text-white/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25 appearance-none pr-7"
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.25)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-[#0c1221] text-white/70">
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
            active ? "text-primary" : "text-white/30 group-hover:text-white/50"
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
          <ArrowUpDown className="h-3 w-3 text-white/15 group-hover:text-white/30" />
        )}
      </div>
    </th>
  );
}
