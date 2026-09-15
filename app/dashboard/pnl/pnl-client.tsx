"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import { Download, Sparkles, Zap, ChevronDown, ChevronRight, ArrowUpRight, ArrowDownRight, Flag, ListTree, Check, X, Loader2, ClipboardList } from "lucide-react";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { sourceLabel } from "@/lib/finance/transaction-status";
import { useNavProgress } from "@/components/dashboard/nav-progress";
import { PageHeader } from "@/components/dashboard/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { FloatingPanel } from "@/components/ui/floating-panel";
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

// ─── Expand (line items) + Review flags ────────────────────────────────────────
type LineItem = { month: string; drill_key: string; party: string; amount: number; txn_count: number };
// One vendor/gateway under a P&L row, with its per-month series across the window.
type PartyRow = { party: string; monthly: Record<string, number>; count: Record<string, number>; total: number };
type ReviewFlag = {
  id: string; drill_key: string; party: string; party_label: string | null; category_label: string | null;
  period_from: string; period_to: string; period_label: string | null; amount_snapshot: number | null;
  note: string | null; status: "open" | "resolved"; created_by_email: string | null; created_at: string;
  resolved_by_email: string | null; resolved_at: string | null;
};
// Stable identity of a flaggable line item for a period (matches uq_pnl_flag_open).
const flagKey = (drillKey: string, party: string, from: string, to: string) => `${drillKey}|${party}|${from}|${to}`;
// Sentinel party for a WHOLE-LINE flag (the category row itself, not one vendor).
const LINE_PARTY = "*";

// Text-size presets (px) driven by the header size control → CSS vars on the table.
type SizeKey = "sm" | "md" | "lg";
// `pf` = flag-icon size (px), kept in line with the numbers and scaling with them.
const SIZE_PRESETS: Record<SizeKey, { label: number; num: number; sub: number; sec: number; pf: number }> = {
  sm: { label: 13, num: 13, sub: 12, sec: 10, pf: 14 },
  md: { label: 15, num: 15, sub: 13.5, sec: 11, pf: 17 },   // default — comfortable
  lg: { label: 17, num: 16.5, sub: 15, sec: 12, pf: 20 },
};

// ─── exact-figure tooltip (single fixed element, avoids table clipping) ────────
const TipCtx = React.createContext<(text: string | null, x?: number, y?: number) => void>(() => {});

// ─── Drill drawer (consolidated by vendor/customer, expandable) ────────────────
type Group = { name: string; amount: number; txn_count: number; email?: string | null; phone?: string | null };
type DrillTxn = { id: string; transaction_date: string; counterparty_name: string | null; amount: number; currency: string | null; source: string | null; status: string | null; email: string | null; phone: string | null; fee: number | null };

const GATEWAY_KEYS = new Set(["revenue", "refunds", "__pg_fees__"]);
const groupDisplayName = (drillKey: string, name: string) =>
  name.startsWith("bank:") ? (name.slice(5) === "—" ? "Bank collection (unnamed)" : name.slice(5)) // bank payer under Gross Revenue
  // disputes_lost top level = payment gateway (stem) → pretty gateway label
  : (GATEWAY_KEYS.has(drillKey) || drillKey === "disputes_lost" ? sourceLabel(name === "—" ? null : name) : name);

function GroupRow({ orgId, drillKey, from, to, g, onFlag, flagged, defaultOpen }: { orgId: string; drillKey: string; from: string; to: string; g: Group; onFlag?: (g: Group) => void; flagged?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  const [txns, setTxns] = React.useState<DrillTxn[] | null>(null);
  const [subs, setSubs] = React.useState<Group[] | null>(null); // disputes: customers under a gateway
  const [loading, setLoading] = React.useState(false);
  // Disputes drill is two-level: gateway (this row) → customers (on expand).
  const isDisputes = drillKey === "disputes_lost";

  const toggle = () => setOpen((o) => !o);

  // Load the drill rows the first time this group is opened (covers defaultOpen too).
  React.useEffect(() => {
    if (!open || txns != null || subs != null || loading) return;
    setLoading(true);
    if (isDisputes) {
      const q = new URLSearchParams({ org: orgId, key: drillKey, from, to, gateway: g.name });
      fetch(`/api/pnl/drill/groups?${q}`)
        .then((r) => r.json())
        .then((d) => setSubs([...(d.groups ?? [])].sort((a: Group, b: Group) => Math.abs(b.amount) - Math.abs(a.amount))))
        .catch(() => setSubs([]))
        .finally(() => setLoading(false));
    } else {
      const q = new URLSearchParams({ org: orgId, key: drillKey, from, to, party: g.name });
      fetch(`/api/pnl/drill?${q}`)
        .then((r) => r.json())
        .then((d) => setTxns([...(d.rows ?? [])].sort((a: DrillTxn, b: DrillTxn) => Math.abs(b.amount) - Math.abs(a.amount))))
        .catch(() => setTxns([]))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="border-b border-border/60">
      <div className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-muted/50">
        <button onClick={toggle} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform flex-shrink-0", open && "rotate-90")} />
          <span className="text-[12.5px] text-foreground truncate flex-1">{groupDisplayName(drillKey, g.name)}</span>
          <span className="text-[10.5px] text-muted-foreground flex-shrink-0">{g.txn_count.toLocaleString("en-IN")}</span>
          <span className="num text-[12.5px] font-semibold text-foreground flex-shrink-0 w-[92px] text-right">{moneyFull(g.amount)}</span>
        </button>
        {onFlag && (
          <button
            onClick={() => onFlag(g)}
            title={flagged ? "Flagged for review — click to update the note" : "Flag for review"}
            className={cn("flex-shrink-0 p-1 rounded-md transition-colors", flagged ? "text-amber-500 hover:bg-amber-500/10" : "text-muted-foreground/40 hover:text-amber-500 hover:bg-muted")}
          >
            <Flag className={cn("h-3.5 w-3.5", flagged && "fill-current")} />
          </button>
        )}
      </div>
      {open && (
        <div className="bg-muted/20">
          {loading && <div className="px-4 py-2 space-y-1.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}</div>}
          {/* Disputes: customer sub-rows (name + contact + amount). */}
          {isDisputes && subs?.map((c, i) => {
            const contact = [c.email, c.phone].filter(Boolean).join(" · ");
            return (
              <div key={`${c.name}-${i}`} className="pl-10 pr-4 py-1.5 flex items-center gap-3 border-t border-border/40">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-foreground truncate">{c.name === "—" ? "Unknown customer" : c.name}</p>
                  {contact && <p className="text-[10.5px] text-muted-foreground/70 truncate">{contact}</p>}
                </div>
                <span className="text-[10.5px] text-muted-foreground flex-shrink-0">{c.txn_count.toLocaleString("en-IN")}</span>
                <p className="num text-[11.5px] font-medium text-foreground flex-shrink-0 w-[92px] text-right">{moneyFull(c.amount)}</p>
              </div>
            );
          })}
          {isDisputes && subs && subs.length === 0 && !loading && <p className="pl-10 pr-4 py-2 text-[11px] text-muted-foreground">No customers.</p>}
          {/* Everything else: transactions. */}
          {!isDisputes && txns?.map((t) => {
            const contact = [t.email, t.phone].filter(Boolean).join(" · ");
            return (
              <div key={t.id} className="pl-10 pr-4 py-1.5 flex items-center gap-3 border-t border-border/40">
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-muted-foreground">{formatDate(t.transaction_date)}{t.source ? ` · ${t.source}` : ""}{t.status ? ` · ${t.status}` : ""}</p>
                  {contact && <p className="text-[10.5px] text-muted-foreground/70 truncate">{contact}</p>}
                </div>
                <p className="num text-[11.5px] text-foreground flex-shrink-0">{t.fee != null ? moneyFull(t.fee) : formatCurrency(t.amount, t.currency || "INR", false)}</p>
              </div>
            );
          })}
          {!isDisputes && txns && txns.length === 0 && !loading && <p className="pl-10 pr-4 py-2 text-[11px] text-muted-foreground">No transactions.</p>}
        </div>
      )}
    </div>
  );
}

function DrillDrawer({
  orgId, open, onClose, title, subtitle, drillKey, from, to, expectedTotal, singleParty, onFlag, flaggedSet,
}: {
  orgId: string; open: boolean; onClose: () => void;
  title: string; subtitle: string; drillKey: string | null; from: string; to: string; expectedTotal: number;
  // When set, the drawer is scoped to ONE vendor/gateway (a clicked line item) —
  // it skips the groups fetch and shows just that party (expanded to its txns).
  singleParty?: Group | null;
  onFlag?: (g: Group, drillKey: string, from: string, to: string) => void;
  flaggedSet?: Set<string>;
}) {
  const [loading, setLoading] = React.useState(false);
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");

  React.useEffect(() => { if (open) setQuery(""); }, [open, drillKey]);

  React.useEffect(() => {
    if (!open || !drillKey) return;
    // Single-party scope: no groups fetch — render the one clicked party directly.
    if (singleParty) { setGroups([singleParty]); setHasMore(false); setErr(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setErr(null); setGroups([]);
    const q = new URLSearchParams({ org: orgId, key: drillKey, from, to });
    fetch(`/api/pnl/drill/groups?${q}`)
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) { setGroups(d.groups ?? []); setHasMore(Boolean(d.hasMore)); } })
      .catch((e) => { if (!cancelled) setErr(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, drillKey, orgId, from, to, singleParty]);

  const byLabel = drillKey && GATEWAY_KEYS.has(drillKey) ? "gateway" : "vendor / customer";
  // Groups arrive sorted by value (desc); filter by the displayed name.
  const shown = query.trim()
    ? groups.filter((g) => groupDisplayName(drillKey ?? "", g.name).toLowerCase().includes(query.trim().toLowerCase()))
    : groups;
  return (
    <FloatingPanel
      open={open}
      onClose={onClose}
      title={title}
      subtitle={`${subtitle} · by ${byLabel}`}
      headerRight={<span className="num text-[13px] font-semibold text-foreground pr-1" title="Total from the P&L rollup">{moneyFull(expectedTotal)}</span>}
      search={{ value: query, onChange: setQuery, placeholder: `Search ${byLabel}…` }}
    >
      <div className="px-4 py-2 border-b border-border flex items-center justify-between sticky top-0 bg-card/95 backdrop-blur z-[1]">
        <span className="text-[12px] text-muted-foreground">{loading ? "Loading…" : `${shown.length}${hasMore && !query ? "+" : ""} ${shown.length === 1 ? "party" : "parties"}`}</span>
      </div>
      {err && <p className="p-4 text-[12px] text-destructive">{err}</p>}
      {loading && <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>}
      {!loading && !err && shown.length === 0 && <p className="p-6 text-center text-[12px] text-muted-foreground">{query ? "No matches." : "Nothing in this slice."}</p>}
      {!loading && drillKey && shown.map((g, i) => (
        <GroupRow
          key={`${g.name}-${i}`} orgId={orgId} drillKey={drillKey} from={from} to={to} g={g}
          defaultOpen={Boolean(singleParty)}
          onFlag={onFlag ? (grp) => onFlag(grp, drillKey, from, to) : undefined}
          flagged={flaggedSet?.has(flagKey(drillKey, g.name, from, to))}
        />
      ))}
      {hasMore && !query && <p className="p-4 text-center text-[11px] text-muted-foreground">Showing the top {groups.length} parties by value.</p>}
    </FloatingPanel>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export function PnlClient({ data, orgId, years }: { data: PnlData; orgId: string; years: number[] }) {
  const { navigate } = useNavProgress();
  const [change, setChange] = React.useState<Mode>("abs");
  const [fyOpen, setFyOpen] = React.useState(false);
  // Tooltip is driven IMPERATIVELY via this ref — never React state — so moving the
  // cursor over the grid (incl. while scrolling, when the browser fires mousemove as
  // content slides under a still cursor) can't re-render the whole table. That
  // re-render storm was the Expand-all scroll lag / mid-scroll tearing.
  const tipRef = React.useRef<HTMLDivElement>(null);
  // Scroll box ref → the virtualizer's scroll element (see bodyUnits / rowVirtualizer).
  // Virtualization keeps only ~viewport rows in the DOM, so the expensive part of
  // Expand-all (≈7k cells) never exists at once and scroll stays smooth at any size.
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [drill, setDrill] = React.useState<{ title: string; subtitle: string; catLabel: string; key: string; from: string; to: string; total: number; party?: Group | null } | null>(null);
  const [monthOpen, setMonthOpen] = React.useState(false); // single-month picker dropdown

  // ── Expand → vendor/gateway line items (lazy: fetched only when first expanded) ──
  const [expandAll, setExpandAll] = React.useState(false);
  const [rowOverride, setRowOverride] = React.useState<Record<string, boolean>>({});
  const [lineItems, setLineItems] = React.useState<LineItem[] | null>(null);
  const [liLoading, setLiLoading] = React.useState(false);
  const isRowOpen = (id: string) => rowOverride[id] ?? expandAll;
  const anyOpen = expandAll || Object.values(rowOverride).some(Boolean);
  const toggleRow = (id: string) => setRowOverride((o) => ({ ...o, [id]: !(o[id] ?? expandAll) }));
  // Global toggle: "Expand all" / "Collapse all" — clears per-row overrides so the
  // switch is decisive (every expandable row follows it).
  const toggleAll = () => { setExpandAll((v) => !v); setRowOverride({}); };

  // ── Text size (compact / comfortable / large), remembered per browser ──
  const [size, setSize] = React.useState<SizeKey>("md");
  React.useEffect(() => {
    try { const s = localStorage.getItem("pnl-size"); if (s === "sm" || s === "md" || s === "lg") setSize(s); } catch { /* private mode */ }
  }, []);
  const changeSize = (s: SizeKey) => { setSize(s); try { localStorage.setItem("pnl-size", s); } catch { /* ignore */ } };
  const sz = SIZE_PRESETS[size];
  const sizeVars = { "--pl": `${sz.label}px`, "--pn": `${sz.num}px`, "--ps": `${sz.sub}px`, "--pc": `${sz.sec}px`, "--pf": `${sz.pf}px` } as React.CSSProperties;

  // ── Review flags ──
  const [flags, setFlags] = React.useState<ReviewFlag[]>([]);      // OPEN flags (for markers)
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const flaggedSet = React.useMemo(() => new Set(flags.map((f) => flagKey(f.drill_key, f.party, f.period_from, f.period_to))), [flags]);

  const setTipCb = React.useCallback((text: string | null, x?: number, y?: number) => {
    const el = tipRef.current;
    if (!el) return;
    if (!text) { el.style.display = "none"; return; }
    el.textContent = text;
    el.style.left = `${(x ?? 0) + 12}px`;
    el.style.top = `${(y ?? 0) + 12}px`;
    el.style.display = "block";
  }, []);

  // Hide the exact-figure tooltip while scrolling (it would otherwise hang mid-air).
  const onGridScroll = React.useCallback(() => { setTipCb(null); }, [setTipCb]);

  const rowsById = React.useMemo(() => Object.fromEntries(data.rows.map((r) => [r.id, r])), [data.rows]);

  // Full window (all month keys) — the span the flag markers + reset key cover.
  const windowRange = React.useMemo(() => {
    const keys = data.columns.flatMap((c) => c.monthKeys).sort();
    if (keys.length === 0) return null;
    return { from: `${keys[0]}-01`, to: lastDayIso(keys[keys.length - 1]) };
  }, [data.columns]);

  // Selected month (Month mode only) — anchor for the 3-month-average feature.
  const selMonth = data.mode === "month" ? (data.columns[0]?.monthKeys[0] ?? null) : null;

  // Line-item FETCH range. Normally the visible window, but in Month mode we reach 3
  // months further back so expanded vendor rows can show the same 3-month average as
  // the P&L lines. The current-month column still sums only the selected month.
  const liRange = React.useMemo(() => {
    if (!windowRange) return null;
    if (selMonth) return { from: `${addMonths(selMonth, -3)}-01`, to: windowRange.to };
    return windowRange;
  }, [windowRange, selMonth]);

  // Reset expansion + line items whenever the viewed window changes.
  const windowKey = windowRange ? `${windowRange.from}|${windowRange.to}` : "";
  React.useEffect(() => { setLineItems(null); setExpandAll(false); setRowOverride({}); }, [windowKey]);

  // Fetch line items the first time anything is expanded (once per window).
  // NB: `liLoading` must NOT be in the deps/guard — setting it true would re-run
  // this effect, whose cleanup cancels the in-flight fetch, so the spinner would
  // never clear and the data would be discarded (the "stuck processing" bug).
  // `lineItems == null` already prevents a duplicate fetch. Always clear the
  // spinner in finally (even if cancelled) so it can never get stuck.
  React.useEffect(() => {
    if (data.preview || !anyOpen || lineItems != null || !liRange) return;
    let cancelled = false;
    setLiLoading(true);
    const q = new URLSearchParams({ org: orgId, from: liRange.from, to: liRange.to });
    fetch(`/api/pnl/lineitems?${q}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (!cancelled) setLineItems((d.items ?? []) as LineItem[]); })
      .catch(() => { if (!cancelled) setLineItems([]); })
      .finally(() => setLiLoading(false));
    return () => { cancelled = true; };
  }, [anyOpen, lineItems, liRange, orgId, data.preview]);

  // Load OPEN flags for markers + the review count (skipped in sample preview).
  const refreshFlags = React.useCallback(() => {
    if (data.preview) return;
    fetch(`/api/pnl/review?status=open`)
      .then((r) => (r.ok ? r.json() : { flags: [] }))
      .then((d) => setFlags((d.flags ?? []) as ReviewFlag[]))
      .catch(() => { /* markers are best-effort */ });
  }, [data.preview]);
  React.useEffect(() => { refreshFlags(); }, [refreshFlags]);

  // drill_keys that actually have line items (so we only show a chevron where it expands).
  const expandableKeys = React.useMemo(() => new Set((lineItems ?? []).map((li) => li.drill_key)), [lineItems]);
  // Which parties (with per-month series) sit under a given drill key, biggest first.
  // `primaryKeys` (Month mode) scopes the sort + visibility to the SELECTED month even
  // though `monthly` also carries the prior months (needed for the 3-month average) —
  // so the vendor set + order stay exactly what you'd see for that month, no phantom
  // rows from months that aren't on screen.
  const partiesFor = React.useCallback((drillK: string, primaryKeys?: string[]): PartyRow[] => {
    if (!lineItems) return [];
    const by = new Map<string, PartyRow>();
    for (const li of lineItems) {
      if (li.drill_key !== drillK) continue;
      let e = by.get(li.party);
      if (!e) { e = { party: li.party, monthly: {}, count: {}, total: 0 }; by.set(li.party, e); }
      e.monthly[li.month] = (e.monthly[li.month] ?? 0) + li.amount;
      e.count[li.month] = (e.count[li.month] ?? 0) + li.txn_count;
      e.total += li.amount;
    }
    const arr = [...by.values()];
    if (primaryKeys && primaryKeys.length) {
      const prim = (p: PartyRow) => primaryKeys.reduce((a, k) => a + (p.monthly[k] ?? 0), 0);
      return arr.filter((p) => prim(p) !== 0).sort((a, b) => Math.abs(prim(b)) - Math.abs(prim(a)));
    }
    return arr.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [lineItems]);

  // ── Month mode: the "Last 3 months average" baseline (the 3 months BEFORE the
  // selected one — a run-rate to compare THIS month against). row.monthly already
  // holds 12 months of history (getPnl fetches a year back), so the average is free
  // for the P&L lines; the wider line-item fetch (liRange) supplies it for vendors. ──
  const prior3Keys = React.useMemo(
    () => (selMonth ? [addMonths(selMonth, -3), addMonths(selMonth, -2), addMonths(selMonth, -1)] : []),
    [selMonth],
  );
  const avg3 = React.useCallback(
    (monthly: Record<string, number>) => (prior3Keys.length ? prior3Keys.reduce((a, k) => a + (monthly[k] ?? 0), 0) / prior3Keys.length : 0),
    [prior3Keys],
  );

  // The last two rows (Net Profit + Net Margin) are pinned to the bottom of the
  // scroll box. They stay in <tbody> (NOT <tfoot> — Safari doesn't honor
  // position:sticky on tfoot cells, which is what broke the freeze) and their
  // cells are sticky-bottom. Net Margin sits at bottom:0; Net Profit sits directly
  // above it, offset by the measured height of the margin row (it can grow when
  // MoM/YoY delta sub-lines appear, so measure rather than hard-code).
  const FOOTER_IDS = React.useMemo(() => new Set(["net_profit", "net_margin"]), []);
  const marginRowRef = React.useRef<HTMLTableRowElement>(null);
  const [marginH, setMarginH] = React.useState(38);
  React.useLayoutEffect(() => {
    if (marginRowRef.current) setMarginH(marginRowRef.current.offsetHeight);
  }, [data, change, size]);

  // Display columns: month/year columns + a Total column (except annual mode).
  const displayCols: PnlColumn[] = React.useMemo(() => {
    if (data.mode === "annual") return data.columns;      // each col already a full year
    if (data.mode === "month") {
      // Single month: the one column IS the total. Add a run-rate pair — "Last 3M avg"
      // (average of the 3 prior months) and "vs 3M avg" (this month vs that baseline) —
      // plus "% of Net Revenue", so the wide space earns its keep and you can see at a
      // glance whether the month is above or below its recent trend.
      const m = data.columns[0];
      if (!m) return data.columns;
      return [
        m,
        { key: "__avg3__", label: "Last 3M avg", monthKeys: m.monthKeys },
        { key: "__davg3__", label: "vs 3M avg", monthKeys: m.monthKeys },
        { key: "__pct__", label: "% of Net Rev", monthKeys: m.monthKeys },
      ];
    }
    const allKeys = data.columns.flatMap((c) => c.monthKeys);
    return [...data.columns, { key: "__total__", label: "Total", monthKeys: allKeys }];
  }, [data.columns, data.mode]);

  // Cap the grid width by column count so few-column views (a single month, a quarter)
  // don't stretch full-width and fling the amount to the window edge with a void between.
  // Month (2 cols) ≈ 820px; grows to the 1400 cap by ~5 columns.
  const gridMaxWidth = Math.min(1400, 440 + displayCols.length * 190);

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

  const colRange = (col: PnlColumn) => ({
    from: `${col.monthKeys[0]}-01`,
    to: lastDayIso(col.monthKeys[col.monthKeys.length - 1]),
    label: col.key === "__total__" ? data.periodLabel : col.label,
  });

  function openDrill(row: PnlRow, col: PnlColumn) {
    if (!row.drill) return;
    const { from, to, label } = colRange(col);
    setDrill({ title: row.label, subtitle: label, catLabel: row.label, key: row.drill, from, to, total: aggVal(row, col), party: null });
  }

  // A vendor/gateway sub-row cell → drill scoped to that ONE party (its txns).
  function openParty(row: PnlRow, col: PnlColumn, p: PartyRow) {
    if (!row.drill) return;
    const { from, to, label } = colRange(col);
    const g: Group = { name: p.party, amount: sumKeys(p.monthly, col.monthKeys), txn_count: sumKeys(p.count, col.monthKeys) };
    setDrill({ title: `${row.label} · ${groupDisplayName(row.drill, p.party)}`, subtitle: label, catLabel: row.label, key: row.drill, from, to, total: g.amount, party: g });
  }

  // ── review flag actions ──
  const raiseFlag = React.useCallback((g: Group, drillK: string, from: string, to: string, opts: { categoryLabel: string; periodLabel: string; partyLabel?: string }) => {
    const label = opts.partyLabel ?? groupDisplayName(drillK, g.name);
    const note = window.prompt(`Flag "${label}" (${opts.periodLabel}) for the accounting team to review.\n\nAdd a note (optional):`, "");
    if (note === null) return; // cancelled
    fetch(`/api/pnl/review`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        drill_key: drillK, party: g.name, party_label: label,
        category_label: opts.categoryLabel, period_from: from, period_to: to, period_label: opts.periodLabel,
        amount: g.amount, note: note.trim(),
      }),
    }).then((r) => { if (r.ok) refreshFlags(); }).catch(() => { /* ignore */ });
  }, [refreshFlags]);

  const resolveFlag = React.useCallback((id: string, status: "open" | "resolved") => {
    fetch(`/api/pnl/review`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).then((r) => { if (r.ok) refreshFlags(); }).catch(() => { /* ignore */ });
  }, [refreshFlags]);

  // Whole-line flag straight from a cell (no drawer): flag THIS line for THIS
  // column's period. Toggling an already-flagged cell resolves it (un-flags).
  const lineDrillKey = (row: PnlRow) => row.drill ?? `line:${row.id}`;
  const cellFlagged = (row: PnlRow, col: PnlColumn) => {
    const { from, to } = colRange(col);
    return flaggedSet.has(flagKey(lineDrillKey(row), LINE_PARTY, from, to));
  };
  const toggleCellFlag = (row: PnlRow, col: PnlColumn) => {
    const dk = lineDrillKey(row);
    const { from, to, label } = colRange(col);
    const existing = flags.find((f) => f.drill_key === dk && f.party === LINE_PARTY && f.period_from === from && f.period_to === to);
    if (existing) { resolveFlag(existing.id, "resolved"); return; }  // toggle off
    raiseFlag({ name: LINE_PARTY, amount: aggVal(row, col), txn_count: 0 }, dk, from, to, { categoryLabel: row.label, periodLabel: label, partyLabel: row.label });
  };
  // Same, but for ONE expanded vendor/gateway line item (party = the vendor).
  const toggleVendorFlag = (row: PnlRow, col: PnlColumn, party: string, amount: number) => {
    const dk = row.drill; if (!dk) return;
    const { from, to, label } = colRange(col);
    const existing = flags.find((f) => f.drill_key === dk && f.party === party && f.period_from === from && f.period_to === to);
    if (existing) { resolveFlag(existing.id, "resolved"); return; }  // toggle off
    raiseFlag({ name: party, amount, txn_count: 0 }, dk, from, to, { categoryLabel: row.label, periodLabel: label });
  };

  // ── period controls ──
  const goMode = (mode: string) => {
    if (mode === "custom") navigate(`/dashboard/pnl?mode=custom&from=${data.from}&to=${data.to}`);
    else if (mode === "month") navigate(`/dashboard/pnl?mode=month&month=${new Date().toISOString().slice(0, 7)}`);
    else navigate(`/dashboard/pnl?mode=${mode}&fy=${data.fyStart}`);
  };
  const today = new Date().toISOString().slice(0, 10);
  const exportHref = (fmt: string) => {
    const q = new URLSearchParams({ format: fmt });
    if (data.mode === "month") {
      // Export reuses the custom-range path for a single month (export route has no month mode).
      const mk = data.columns[0]?.monthKeys[0] ?? new Date().toISOString().slice(0, 7);
      q.set("mode", "custom"); q.set("from", `${mk}-01`); q.set("to", lastDayIso(mk));
    } else {
      q.set("mode", data.mode); q.set("fy", String(data.fyStart));
      if (data.mode === "custom") { q.set("from", data.from ?? ""); q.set("to", data.to ?? ""); }
    }
    return `/api/pnl/export?${q}`;
  };

  const ModeBtn = ({ m, label }: { m: string; label: string }) => (
    <button onClick={() => goMode(m)} className={cn("h-8 px-3 text-[12px] font-medium transition-colors", data.mode === m ? "bg-sidebar text-white" : "text-muted-foreground hover:bg-muted")}>{label}</button>
  );

  // Months to offer in the single-month picker: the selected FY's 12 months, current + prior FY.
  const monthOptions = React.useMemo(() => {
    const opts: { key: string; label: string }[] = [];
    const now = new Date();
    for (let i = 0; i < 24; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      opts.push({ key, label: d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) });
    }
    return opts;
  }, []);
  const currentMonthKey = data.mode === "month" ? (data.columns[0]?.monthKeys[0] ?? "") : "";

  // ── single-<tr> renderers ────────────────────────────────────────────────────
  // The body is VIRTUALIZED (see bodyUnits / rowVirtualizer): each render unit is
  // exactly one <tr>, so the virtualizer can measure + window them. `m` carries the
  // virtualizer's measure ref + data-index (+ React key) for the rows it renders;
  // it's absent when a <tr> is rendered directly (footers, non-virtualized fallback).
  type MeasureProps = { trRef?: React.Ref<HTMLTableRowElement>; dataIndex?: number; key?: string };

  // Faint group heading above a section's first row.
  const renderSectionTr = (row: PnlRow, m?: MeasureProps) => (
    <tr key={m?.key} ref={m?.trRef} data-index={m?.dataIndex}>
      <td colSpan={displayCols.length + 1} className="sticky left-0 bg-card px-4 pt-3 pb-1 text-[length:var(--pc)] font-semibold uppercase tracking-wide text-muted-foreground/70">{row.section}</td>
    </tr>
  );

  // Loading / empty placeholder under an expanded row.
  const renderNoticeTr = (row: PnlRow, kind: "loading" | "empty", m?: MeasureProps) =>
    kind === "loading" ? (
      <tr key={m?.key} ref={m?.trRef} data-index={m?.dataIndex} className="border-b border-border/40">
        <td colSpan={displayCols.length + 1} className="sticky left-0 bg-card px-3 py-2 pl-10 text-[11.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading line items…</span>
        </td>
      </tr>
    ) : (
      <tr key={m?.key} ref={m?.trRef} data-index={m?.dataIndex} className="border-b border-border/40">
        <td colSpan={displayCols.length + 1} className="sticky left-0 bg-card px-3 py-1.5 pl-10 text-[11px] text-muted-foreground/70">No line items.</td>
      </tr>
    );

  // Main P&L row. `stickyBottom` (px, or 0) pins it as a sticky footer row — the cells
  // (not the <tr>, which doesn't stick reliably) get position:sticky + an OPAQUE
  // background so scrolling body rows never bleed through, and a z-index above the
  // body's sticky left column.
  const renderMainTr = (row: PnlRow, stickyBottom?: number, m?: MeasureProps) => {
    const strong = row.emphasis === "strong";
    const isCm = row.emphasis === "cm";
    const isTotalRow = row.kind === "total";
    const isMargin = row.kind === "margin";
    const isNetProfit = row.id === "net_profit";
    const sticky = stickyBottom !== undefined;
    // Opaque band colour for the pinned rows (translucent tints would bleed).
    const footerBg = isTotalRow ? "bg-muted" : "bg-card";
    // Expandable = a drillable line that actually has vendor/gateway line items.
    const canExpand = Boolean(row.drill) && !sticky && !data.preview && expandableKeys.has(row.drill as string);
    const open = canExpand && isRowOpen(row.id);
    return (
        <tr
          key={m?.key}
          ref={m?.trRef ?? (row.id === "net_margin" ? marginRowRef : undefined)}
          data-index={m?.dataIndex}
          className={cn(
            "border-b border-border/50",
            !sticky && strong && "bg-muted/40",
            !sticky && isCm && "bg-primary/[0.055]",
            !sticky && isTotalRow && "bg-primary/[0.09]",
            isNetProfit && "border-t-2 border-border"
          )}
        >
          <td
            style={sticky ? { bottom: stickyBottom } : undefined}
            className={cn(
              // Sticky label column MUST be opaque or right-scrolled month
              // values bleed through the translucent tints.
              "sticky left-0 z-[1] px-4 py-2 whitespace-nowrap border-r border-border text-[length:var(--pl)]",
              (strong || isCm || isTotalRow) ? "bg-muted" : "bg-card",
              sticky && `${footerBg} z-[8]`,
              strong ? "font-bold text-foreground" : isCm ? "font-semibold text-foreground" : "text-foreground/90",
              isTotalRow && "font-bold",
              row.kind === "expense" && "pl-7 text-[length:var(--ps)] text-muted-foreground font-normal"
            )}
          >
            {canExpand ? (
              <button type="button" onClick={() => toggleRow(row.id)} className="inline-flex items-center gap-1 text-left hover:opacity-80" title={open ? "Collapse" : "Expand line items"}>
                <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform flex-shrink-0", open && "rotate-90")} />
                {row.label}
              </button>
            ) : row.label}
          </td>
          {displayCols.map((col, cIdx) => {
            // "Last 3M avg" column (Month mode): average of the 3 prior months.
            if (col.key === "__avg3__") {
              const a = row.kind === "margin" ? 0 : avg3(row.monthly);
              const full = a !== 0 ? moneyFull(a) : "";
              return (
                <td
                  key={col.key}
                  style={sticky ? { bottom: stickyBottom } : undefined}
                  className={cn(
                    "text-right px-4 py-2 num align-top border-l border-border/60 text-[length:var(--ps)] text-muted-foreground",
                    sticky && `sticky ${footerBg} z-[7]`,
                    isTotalRow && "font-semibold text-foreground/80"
                  )}
                  onMouseEnter={(e) => a !== 0 && setTipCb(full, e.clientX, e.clientY)}
                  onMouseLeave={() => setTipCb(null)}
                >
                  {row.kind === "margin" ? "" : (a === 0 ? "–" : cellText(row, a))}
                </td>
              );
            }
            // "vs 3M avg" column (Month mode): this month vs the 3-month baseline, %.
            if (col.key === "__davg3__") {
              const a = row.kind === "margin" ? 0 : avg3(row.monthly);
              const cur = selMonth ? (row.monthly[selMonth] ?? 0) : 0;
              const d = a !== 0 ? ((cur - a) / Math.abs(a)) * 100 : null;
              return (
                <td
                  key={col.key}
                  style={sticky ? { bottom: stickyBottom } : undefined}
                  className={cn(
                    "text-right px-4 py-2 num align-top border-l border-border/60 text-[length:var(--ps)]",
                    sticky && `sticky ${footerBg} z-[7]`
                  )}
                >
                  {row.kind === "margin" || d === null ? (
                    <span className="text-muted-foreground/50">{row.kind === "margin" ? "" : "–"}</span>
                  ) : (
                    <span className={cn("inline-flex items-center justify-end gap-0.5 font-medium", (d >= 0) === goodWhenUp(row) ? "text-success" : "text-destructive")}>
                      {d >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(d).toFixed(1)}%
                    </span>
                  )}
                </td>
              );
            }
            // "% of Net Revenue" column (single-month view): each line's share of NR.
            if (col.key === "__pct__") {
              const nr = aggVal(rowsById["net_revenue"], col);
              const amt = aggVal(row, col);
              const share = nr ? (amt / nr) * 100 : null;
              const showShare = row.kind !== "margin" && share != null && amt !== 0;
              return (
                <td
                  key={col.key}
                  style={sticky ? { bottom: stickyBottom } : undefined}
                  className={cn(
                    "text-right px-4 py-2 num align-top border-l border-border/60 text-[length:var(--ps)] text-muted-foreground",
                    sticky && `sticky ${footerBg} z-[7]`,
                    isTotalRow && "font-semibold text-foreground/80"
                  )}
                >
                  {showShare ? `${share.toFixed(1)}%` : (row.kind === "margin" ? "" : "–")}
                </td>
              );
            }
            const v = aggVal(row, col);
            const pct = pctVal(row, col);
            const delta = deltaVal(row, col);
            const drillable = Boolean(row.drill) && v !== 0;
            const zebra = !sticky && col.key !== "__total__" && cIdx % 2 === 1;
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
                style={sticky ? { bottom: stickyBottom } : undefined}
                className={cn(
                  "text-right px-4 py-2 num align-top border-l border-border/60",
                  !sticky && "relative group/cell",
                  zebra && "bg-foreground/[0.06]",   // alternate-column banding (visible)
                  !sticky && col.key === "__total__" && "bg-muted/30",
                  // Footer rows (Net Profit / Net Margin): the number cells must
                  // ALSO be position:sticky — otherwise the inline `bottom` offset
                  // is inert and only the left label pins while the figures scroll
                  // past and overlap. `sticky` here = the vertical-bottom pin; they
                  // still scroll horizontally with the month columns (no left set).
                  sticky && `sticky ${footerBg} z-[7]`
                )}
                onMouseEnter={(e) => v !== 0 && setTipCb(full, e.clientX, e.clientY)}
                onMouseLeave={() => setTipCb(null)}
              >
                {/* Flag THIS line for review straight from the cell — no drawer. Amber
                    when already flagged (persistent marker); otherwise appears on hover. */}
                {!sticky && !data.preview && row.kind !== "margin" && v !== 0 && (() => {
                  const flagged = cellFlagged(row, col);
                  return (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleCellFlag(row, col); }}
                      title={flagged ? "Flagged for review — click to unflag" : "Flag this line for review"}
                      className={cn(
                        "absolute left-2 top-2 p-0.5 rounded z-[2]",
                        flagged ? "text-amber-500" : "hidden group-hover/cell:block text-muted-foreground/40 hover:text-amber-500"
                      )}
                    >
                      <Flag className={cn(flagged && "fill-current")} style={{ width: "var(--pf)", height: "var(--pf)" }} />
                    </button>
                  );
                })()}
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
    );
  };

  // One vendor / gateway line item under an expanded row.
  const renderPartyTr = (row: PnlRow, p: PartyRow, m?: MeasureProps) => (
          <tr key={m?.key} ref={m?.trRef} data-index={m?.dataIndex} className="border-b border-border/30 bg-card/60">
            <td className="sticky left-0 z-[1] bg-card px-4 py-1.5 pl-11 whitespace-nowrap border-r border-border text-[length:var(--ps)] text-foreground/75">
              <span className="block max-w-[300px] truncate" title={groupDisplayName(row.drill as string, p.party)}>{groupDisplayName(row.drill as string, p.party)}</span>
            </td>
            {displayCols.map((col, cIdx) => {
              const v = sumKeys(p.monthly, col.monthKeys);
              // "Last 3M avg" for a vendor/gateway line (Month mode). v here = this month.
              if (col.key === "__avg3__") {
                const a = avg3(p.monthly);
                return (
                  <td key={col.key} className="text-right px-4 py-1.5 num text-[length:var(--ps)] text-muted-foreground/70 border-l border-border/50">
                    {a !== 0 ? cellText(row, a) : "–"}
                  </td>
                );
              }
              // "vs 3M avg" for a vendor/gateway line (Month mode): this month vs baseline.
              if (col.key === "__davg3__") {
                const a = avg3(p.monthly);
                const d = a !== 0 ? ((v - a) / Math.abs(a)) * 100 : null;
                return (
                  <td key={col.key} className="text-right px-4 py-1.5 num text-[length:var(--ps)] border-l border-border/50">
                    {d === null ? <span className="text-muted-foreground/40">–</span> : (
                      <span className={cn("inline-flex items-center justify-end gap-0.5", (d >= 0) === goodWhenUp(row) ? "text-success" : "text-destructive")}>
                        {d >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(d).toFixed(1)}%
                      </span>
                    )}
                  </td>
                );
              }
              // "% of Net Revenue" column (single-month view) for a vendor/gateway line.
              if (col.key === "__pct__") {
                const nr = aggVal(rowsById["net_revenue"], col);
                const share = nr ? (v / nr) * 100 : null;
                return (
                  <td key={col.key} className="text-right px-4 py-1.5 num text-[length:var(--ps)] text-muted-foreground/70 border-l border-border/50">
                    {v !== 0 && share != null ? `${share.toFixed(1)}%` : ""}
                  </td>
                );
              }
              const cnt = sumKeys(p.count, col.monthKeys);
              const { from, to } = colRange(col);
              const isFlagged = flaggedSet.has(flagKey(row.drill as string, p.party, from, to));
              const zebra = col.key !== "__total__" && cIdx % 2 === 1;
              const full = moneyFull(v);
              return (
                <td
                  key={col.key}
                  className={cn("text-right px-4 py-1.5 num align-top border-l border-border/50 text-[length:var(--ps)] relative group/cell", zebra && "bg-foreground/[0.06]", col.key === "__total__" && "bg-muted/30")}
                  onMouseEnter={(e) => v !== 0 && setTipCb(full, e.clientX, e.clientY)}
                  onMouseLeave={() => setTipCb(null)}
                >
                  {/* Flag THIS vendor line item for review (no drawer). Amber + persistent
                      when flagged; appears on hover otherwise. */}
                  {!data.preview && v !== 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleVendorFlag(row, col, p.party, v); }}
                      title={isFlagged ? "Flagged for review — click to unflag" : "Flag this line item for review"}
                      className={cn("absolute left-2 top-1.5 p-0.5 rounded z-[2]", isFlagged ? "text-amber-500" : "hidden group-hover/cell:block text-muted-foreground/40 hover:text-amber-500")}
                    >
                      <Flag className={cn(isFlagged && "fill-current")} style={{ width: "var(--pf)", height: "var(--pf)" }} />
                    </button>
                  )}
                  {v === 0 ? (
                    <span className="text-muted-foreground/40">–</span>
                  ) : (
                    <button type="button" onClick={() => openParty(row, col, p)} className="inline-block leading-tight hover:underline decoration-dotted cursor-pointer" title={cnt > 0 ? `${cnt.toLocaleString("en-IN")} transaction${cnt === 1 ? "" : "s"} — click to view` : "Click to view transactions"}>
                      {cellText(row, v)}
                    </button>
                  )}
                </td>
              );
            })}
          </tr>
  );

  // Compose a full row group (section + main + its line items) as ONE fragment.
  // Used for the sticky footers and the non-virtualized fallback (small views). The
  // virtualized body calls the single-<tr> renderers above directly, per unit.
  const renderRow = (row: PnlRow, stickyBottom?: number) => {
    const sticky = stickyBottom !== undefined;
    const canExpand = Boolean(row.drill) && !sticky && !data.preview && expandableKeys.has(row.drill as string);
    const open = canExpand && isRowOpen(row.id);
    const parties = open ? partiesFor(row.drill as string, selMonth ? [selMonth] : undefined) : [];
    return (
      <React.Fragment key={row.id}>
        {row.section && !sticky && renderSectionTr(row)}
        {renderMainTr(row, stickyBottom)}
        {open && liLoading && parties.length === 0 && renderNoticeTr(row, "loading")}
        {open && !liLoading && parties.length === 0 && renderNoticeTr(row, "empty")}
        {open && parties.map((p) => renderPartyTr(row, p, { key: `${row.id}::${p.party}` }))}
      </React.Fragment>
    );
  };

  // ── flat body units (one per <tr>) + row virtualizer ─────────────────────────
  // Each unit renders to exactly one <tr>; the virtualizer windows them so only the
  // ~viewport rows (plus overscan) are ever in the DOM. Footer rows (Net Profit /
  // Net Margin) are NOT units — they render separately, pinned sticky-bottom.
  type BodyUnit =
    | { t: "section"; key: string; row: PnlRow }
    | { t: "row"; key: string; row: PnlRow }
    | { t: "loading"; key: string; row: PnlRow }
    | { t: "empty"; key: string; row: PnlRow }
    | { t: "party"; key: string; row: PnlRow; p: PartyRow };

  const bodyUnits = React.useMemo<BodyUnit[]>(() => {
    const units: BodyUnit[] = [];
    for (const row of data.rows) {
      if (FOOTER_IDS.has(row.id)) continue;               // footers render separately
      if (row.section) units.push({ t: "section", key: `sec:${row.id}`, row });
      units.push({ t: "row", key: row.id, row });
      const canExpand = Boolean(row.drill) && !data.preview && expandableKeys.has(row.drill as string);
      if (!(canExpand && (rowOverride[row.id] ?? expandAll))) continue;
      const parties = partiesFor(row.drill as string, selMonth ? [selMonth] : undefined);
      if (parties.length === 0) {
        units.push({ t: liLoading ? "loading" : "empty", key: `li:${row.id}`, row });
      } else {
        for (const p of parties) units.push({ t: "party", key: `${row.id}::${p.party}`, row, p });
      }
    }
    return units;
  }, [data.rows, data.preview, FOOTER_IDS, expandableKeys, rowOverride, expandAll, liLoading, partiesFor, selMonth]);

  // Below this many rows the native table is already smooth — keep the proven,
  // SSR-friendly path and skip virtualization entirely (collapsed view, small FYs).
  const virtualize = bodyUnits.length > 80;

  const estimateSize = React.useCallback((i: number) => {
    const u = bodyUnits[i];
    if (!u) return 40;
    if (u.t === "section") return sz.sec + 14;
    if (u.t !== "row") return sz.sub + 14;                // party / loading / empty
    let h = sz.label + 18;                                // main row (py-2 + line)
    if (change !== "abs" && u.row.kind !== "margin") h += 14; // MoM/YoY delta subline
    if (u.row.emphasis === "cm") h += 14;                 // "% margin" subline
    return h;
  }, [bodyUnits, sz, change]);

  const rowVirtualizer = useVirtualizer({
    count: bodyUnits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 16,
    getItemKey: React.useCallback((i: number) => bodyUnits[i]?.key ?? String(i), [bodyUnits]),
  });

  // Text-size / delta-mode changes alter every row's height → drop cached measurements
  // so the virtualizer re-measures against the new sizes (avoids scroll drift).
  React.useEffect(() => { rowVirtualizer.measure(); }, [size, change, rowVirtualizer]);

  const renderUnit = (u: BodyUnit, m: MeasureProps) => {
    if (u.t === "section") return renderSectionTr(u.row, m);
    if (u.t === "row") return renderMainTr(u.row, undefined, m);
    if (u.t === "party") return renderPartyTr(u.row, u.p, m);
    return renderNoticeTr(u.row, u.t === "loading" ? "loading" : "empty", m);
  };

  return (
    <TipCtx.Provider value={setTipCb}>
    {/* Full-height flex column so the table's scroll box fills the viewport and its
        BOTTOM edge is always visible — that's what makes the sticky Net Profit /
        Net Margin rows actually pin (a max-height box whose bottom sits below the
        fold, or that doesn't scroll internally, can't show a frozen footer). */}
    <div className="flex flex-col h-full max-w-[1400px] gap-3">
      <PageHeader title="Profit & Loss" subtitle={`Month-wise P&L · ${data.periodLabel}`}>
        {/* view mode */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden">
          <ModeBtn m="monthly" label="Monthly" />
          <ModeBtn m="quarterly" label="Quarterly" />
          <ModeBtn m="annual" label="Annual" />
          <ModeBtn m="month" label="Month" />
          <ModeBtn m="custom" label="Custom" />
        </div>

        {/* single-month picker */}
        {data.mode === "month" && (
          <div className="relative">
            <button onClick={() => setMonthOpen((o) => !o)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12.5px] font-medium hover:bg-muted">
              {data.periodLabel}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {monthOpen && (
              <>
                <div className="fixed inset-0 z-[90]" onClick={() => setMonthOpen(false)} />
                <div className="absolute right-0 mt-1 w-44 max-h-72 overflow-auto rounded-lg border border-border bg-card shadow-lg z-[91] py-1">
                  {monthOptions.map((mo) => (
                    <button key={mo.key} onClick={() => { setMonthOpen(false); navigate(`/dashboard/pnl?mode=month&month=${mo.key}`); }}
                      className={cn("w-full text-left px-3 py-1.5 text-[12.5px] hover:bg-muted", mo.key === currentMonthKey ? "text-primary font-semibold" : "text-foreground")}>
                      {mo.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* FY dropdown (monthly + quarterly + annual) */}
        {data.mode !== "custom" && data.mode !== "month" && (
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
            <button key={m} onClick={() => setChange(m)} className={cn("h-8 px-2.5 text-[12px] font-medium transition-colors", change === m ? "bg-sidebar text-white" : "text-muted-foreground hover:bg-muted")}>{label}</button>
          ))}
        </div>

        {/* text-size control (compact / comfortable / large) — remembered per browser */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden" title="Text size">
          {(["sm", "md", "lg"] as SizeKey[]).map((s, i) => (
            <button key={s} onClick={() => changeSize(s)} title={`${["Compact", "Comfortable", "Large"][i]} text`}
              className={cn("h-8 w-8 font-semibold leading-none transition-colors flex items-center justify-center", size === s ? "bg-sidebar text-white" : "text-muted-foreground hover:bg-muted")}
              style={{ fontSize: [11, 13, 15][i] }}>A</button>
          ))}
        </div>

        {!data.preview && (
          <>
            {/* Expand → show every line's vendors/gateways inline (Excel outline feel).
                Hidden in Annual mode (a 5-year vendor-grain scan is heavy + rarely useful). */}
            {data.mode !== "annual" && (
              <button
                onClick={toggleAll}
                className={cn("inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[12px] font-medium transition-colors",
                  anyOpen ? "bg-sidebar text-white border-sidebar" : "border-border text-foreground hover:bg-muted")}
                title="Expand all rows into their vendor / gateway line items"
              >
                <ListTree className="h-3.5 w-3.5" />
                {expandAll ? "Collapse all" : "Expand all"}
                {liLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              </button>
            )}

            {/* Review queue */}
            <button
              onClick={() => setReviewOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border text-[12px] font-medium hover:bg-muted"
              title="Items flagged for the accounting team to review"
            >
              <ClipboardList className="h-3.5 w-3.5" /> Review
              {flags.length > 0 && <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold">{flags.length}</span>}
            </button>

            <div className="inline-flex gap-1.5">
              <a href={exportHref("csv")} className="inline-flex items-center gap-1 text-[12px] h-8 px-2.5 rounded-lg border border-border hover:bg-muted"><Download className="h-3.5 w-3.5" /> CSV</a>
              <a href={exportHref("xlsx")} className="inline-flex items-center gap-1 text-[12px] h-8 px-2.5 rounded-lg border border-border hover:bg-muted"><Download className="h-3.5 w-3.5" /> Excel</a>
            </div>
          </>
        )}
      </PageHeader>

      {data.preview && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-2.5">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <p className="text-[12.5px] text-foreground/80 flex-1 min-w-0"><span className="font-semibold text-foreground">Preview — sample data.</span> Connect a source to replace this with your real P&L.</p>
          <Link href="/dashboard/connectors" className="flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 flex-shrink-0"><Zap className="h-3.5 w-3.5" /> Connect</Link>
        </div>
      )}

      {/* grid — fills remaining height; header row (top) + line-item column (left)
          + Net Profit/Margin rows (bottom) all stay frozen within this scroll box. */}
      <div className="flex-1 min-h-0 w-full rounded-xl border border-border bg-card overflow-hidden" style={{ maxWidth: gridMaxWidth }}>
        <div ref={scrollRef} className="h-full overflow-auto" onScroll={onGridScroll}>
          <table className="w-full border-collapse text-[length:var(--pn)]" style={sizeVars}>
            <thead>
              <tr className="border-b-2 border-border">
                <th className="sticky left-0 top-0 z-[6] bg-sidebar text-left font-semibold text-white text-[length:var(--pn)] px-4 py-2.5 min-w-[300px] border-r border-white/10">Particulars</th>
                {displayCols.map((c) => (
                  <th key={c.key} className={cn("sticky top-0 z-[4] bg-sidebar text-right font-semibold text-white/80 text-[length:var(--pn)] px-4 py-2.5 whitespace-nowrap min-w-[128px] border-l border-white/10", c.key === "__total__" && "font-bold text-white", (c.key === "__pct__" || c.key === "__avg3__" || c.key === "__davg3__") && "text-white/60")}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Body: virtualized (only ~viewport rows in the DOM) once past 80 rows;
                  the native path below stays for small views (SSR-friendly). Footer
                  rows render after either path, pinned sticky-bottom. */}
              {virtualize ? (() => {
                const vItems = rowVirtualizer.getVirtualItems();
                const total = rowVirtualizer.getTotalSize();
                const colSpan = displayCols.length + 1;
                const padTop = vItems.length ? vItems[0].start : 0;
                const padBottom = vItems.length ? total - vItems[vItems.length - 1].end : 0;
                return (
                  <>
                    {padTop > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: padTop, padding: 0, border: 0 }} /></tr>}
                    {vItems.map((vi) => {
                      const u = bodyUnits[vi.index];
                      return u ? renderUnit(u, { key: u.key, trRef: rowVirtualizer.measureElement, dataIndex: vi.index }) : null;
                    })}
                    {padBottom > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: padBottom, padding: 0, border: 0 }} /></tr>}
                  </>
                );
              })() : (
                data.rows.filter((row) => !FOOTER_IDS.has(row.id)).map((row) => renderRow(row))
              )}
              {/* Sticky footers — always in the DOM, never virtualized. */}
              {data.rows.filter((row) => FOOTER_IDS.has(row.id)).map((row) => renderRow(row, row.id === "net_margin" ? 0 : marginH))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground px-1">
        Revenue ties to your dashboard. <span className="font-medium text-foreground/70">Payment Gateway Fees</span> includes gateway charges + Apple App Store commission.
        CM tiers are % of Net Revenue. Click any cell to drill in by vendor/customer.
      </p>

      {/* exact-figure tooltip — positioned + toggled imperatively via tipRef (no state). */}
      <div ref={tipRef} className="fixed z-[200] pointer-events-none px-2 py-1 rounded-md bg-foreground text-background text-[11px] font-medium num shadow-lg" style={{ display: "none", left: 0, top: 0 }} />

      <DrillDrawer orgId={orgId} open={drill != null} onClose={() => setDrill(null)}
        title={drill?.title ?? ""} subtitle={drill?.subtitle ?? ""} drillKey={drill?.key ?? null}
        from={drill?.from ?? ""} to={drill?.to ?? ""} expectedTotal={drill?.total ?? 0}
        singleParty={drill?.party ?? null}
        flaggedSet={flaggedSet}
        onFlag={data.preview ? undefined : (g, drillK, from, to) => raiseFlag(g, drillK, from, to, { categoryLabel: drill?.catLabel ?? drillK, periodLabel: drill?.subtitle ?? "" })}
      />

      <ReviewPanel open={reviewOpen} onClose={() => setReviewOpen(false)} onChanged={refreshFlags} onResolve={resolveFlag} />
    </div>
    </TipCtx.Provider>
  );
}

// ─── Review queue (accounting worklist) ────────────────────────────────────────
function ReviewPanel({ open, onClose, onChanged, onResolve }: { open: boolean; onClose: () => void; onChanged: () => void; onResolve: (id: string, status: "open" | "resolved") => void }) {
  const [tab, setTab] = React.useState<"open" | "resolved">("open");
  const [rows, setRows] = React.useState<ReviewFlag[]>([]);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch(`/api/pnl/review?status=${tab}`)
      .then((r) => (r.ok ? r.json() : { flags: [] }))
      .then((d) => setRows((d.flags ?? []) as ReviewFlag[]))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [tab]);
  React.useEffect(() => { if (open) load(); }, [open, load]);

  const act = (id: string, status: "open" | "resolved") => { onResolve(id, status); onChanged(); setTimeout(load, 250); };

  return (
    <FloatingPanel open={open} onClose={onClose} title="Review queue" subtitle="Items flagged for the accounting team">
      <div className="px-4 py-2 border-b border-border flex items-center gap-1 sticky top-0 bg-card/95 backdrop-blur z-[1]">
        {(["open", "resolved"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("h-7 px-3 rounded-md text-[12px] font-medium capitalize", tab === t ? "bg-sidebar text-white" : "text-muted-foreground hover:bg-muted")}>{t}</button>
        ))}
      </div>
      {loading && <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>}
      {!loading && rows.length === 0 && <p className="p-6 text-center text-[12px] text-muted-foreground">{tab === "open" ? "No open items. Flag a vendor from any expanded row." : "No resolved items yet."}</p>}
      {!loading && rows.map((f) => (
        <div key={f.id} className="px-4 py-3 border-b border-border/60">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground truncate">{f.party_label || f.party}</p>
              <p className="text-[11.5px] text-muted-foreground">{[f.category_label, f.period_label].filter(Boolean).join(" · ")}</p>
              {f.note && <p className="text-[12px] text-foreground/80 mt-1 whitespace-pre-wrap break-words">{f.note}</p>}
              <p className="text-[10.5px] text-muted-foreground/70 mt-1">
                {f.amount_snapshot != null && <span className="num">{moneyFull(f.amount_snapshot)}</span>}
                {f.created_by_email ? ` · raised by ${f.created_by_email}` : ""}
                {f.status === "resolved" && f.resolved_by_email ? ` · resolved by ${f.resolved_by_email}` : ""}
              </p>
            </div>
            {tab === "open" ? (
              <button onClick={() => act(f.id, "resolved")} className="flex-shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-success/10 text-success text-[11.5px] font-medium hover:bg-success/20"><Check className="h-3.5 w-3.5" /> Resolve</button>
            ) : (
              <button onClick={() => act(f.id, "open")} className="flex-shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-border text-[11.5px] font-medium hover:bg-muted"><X className="h-3.5 w-3.5" /> Reopen</button>
            )}
          </div>
        </div>
      ))}
    </FloatingPanel>
  );
}
