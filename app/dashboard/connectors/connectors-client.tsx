"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  CheckCircle2,
  RefreshCw,
  Upload,
  X,
  Zap,
  Trash2,
  Plus,
  Pencil,
  Landmark,
  FileSpreadsheet,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { cn, formatDate, fyStartISO } from "@/lib/utils";
import type { Connector } from "@/lib/supabase/types";

// ─── Connector definitions ────────────────────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
  isPassword?: boolean;
  isOptional?: boolean;
}

interface ConnectorDef {
  type: Connector["type"];
  name: string;
  description: string;
  icon: React.ReactNode;
  fields?: FieldDef[];
  isCSV?: boolean;
  // Webhook-only connector (no polling API): the endpoint path to display so the
  // user can register it with the provider. Shown as a setup note in the modal.
  webhookPath?: string;
}

// ─── Logo helpers ─────────────────────────────────────────────────────────────

/** White Simple Icons logo on a brand-colored rounded square.
 *  Falls back to a letter-mark if the CDN doesn't have the slug. */
function SiIcon({ slug, bg }: { slug: string; bg: string }) {
  const [broken, setBroken] = React.useState(false);
  const letters = slug.slice(0, 2).toUpperCase();

  if (broken) {
    return (
      <div
        className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-[11px] tracking-tight text-white select-none"
        style={{ background: bg }}
      >
        {letters}
      </div>
    );
  }

  return (
    <div
      className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: bg }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://cdn.simpleicons.org/${slug}/ffffff`}
        alt={slug}
        width={22}
        height={22}
        style={{ width: 22, height: 22 }}
        onError={() => setBroken(true)}
      />
    </div>
  );
}

/** Letter-mark logo for gateways not in Simple Icons. */
function LetterIcon({ letters, bg }: { letters: string; bg: string }) {
  return (
    <div
      className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-[11px] tracking-tight text-white select-none"
      style={{ background: bg }}
    >
      {letters}
    </div>
  );
}

/** Lucide icon on a tinted rounded square (for upload-type connectors). */
function LucideIcon({ icon, bg }: { icon: React.ReactNode; bg: string }) {
  return (
    <div
      className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
      style={{ background: bg }}
    >
      {icon}
    </div>
  );
}

const CONNECTOR_DEFS: ConnectorDef[] = [
  {
    type: "razorpay",
    name: "Razorpay",
    description: "Payments, refunds, settlements, disputes",
    icon: <SiIcon slug="razorpay" bg="#2D81F7" />,
    fields: [
      { key: "key_id",         label: "Key ID",                   placeholder: "rzp_live_..." },
      { key: "key_secret",     label: "Key Secret",               isPassword: true, placeholder: "••••••••••••••••" },
      { key: "account_number", label: "RazorpayX Account No.", placeholder: "RazorpayX only — leave blank if unused", isOptional: true },
      { key: "email",          label: "Account Email",            placeholder: "you@company.com", isOptional: true },
      { key: "mid",            label: "Merchant ID (MID)",        placeholder: "MID12345", isOptional: true },
    ],
  },
  {
    type: "stripe",
    name: "Stripe",
    description: "Charges, payouts, and invoices",
    icon: <SiIcon slug="stripe" bg="#635BFF" />,
    fields: [
      { key: "secret_key", label: "Secret Key", isPassword: true, placeholder: "sk_live_..." },
      { key: "email",      label: "Account Email", placeholder: "you@company.com", isOptional: true },
      { key: "mid",        label: "Account ID",    placeholder: "acct_xxx", isOptional: true },
    ],
  },
  {
    type: "zoho",
    name: "Zoho Books",
    description: "Invoices, bills, and journal entries",
    icon: <SiIcon slug="zoho" bg="#E42527" />,
    fields: [
      { key: "client_id",     label: "Client ID",     placeholder: "1000.XXXX..." },
      { key: "client_secret", label: "Client Secret", isPassword: true, placeholder: "••••••••" },
      { key: "org_id",        label: "Organisation ID", placeholder: "20XXXXXXXX" },
      { key: "email",         label: "Account Email",   placeholder: "you@company.com", isOptional: true },
    ],
  },
  {
    type: "quickbooks",
    name: "QuickBooks",
    description: "P&L, balance sheet, transactions",
    icon: <SiIcon slug="quickbooks" bg="#2CA01C" />,
    fields: [
      { key: "client_id",     label: "Client ID",     placeholder: "ABc1234..." },
      { key: "client_secret", label: "Client Secret", isPassword: true, placeholder: "••••••••" },
      { key: "realm_id",      label: "Realm ID",      placeholder: "1234567890" },
      { key: "email",         label: "Account Email",  placeholder: "you@company.com", isOptional: true },
    ],
  },
  {
    type: "tally",
    name: "Tally",
    description: "Tally ERP vouchers and ledgers",
    icon: <LetterIcon letters="T" bg="#F2542D" />,
    fields: [
      { key: "host",  label: "Tally Host", placeholder: "localhost" },
      { key: "port",  label: "Port",       placeholder: "9000" },
      { key: "email", label: "Account Email", placeholder: "you@company.com", isOptional: true },
      { key: "mid",   label: "Company ID",    placeholder: "COMP01", isOptional: true },
    ],
  },
  {
    type: "cashfree",
    name: "Cashfree",
    description: "Orders, settlements, and refunds",
    icon: <LetterIcon letters="CF" bg="#1B2CC1" />,
    fields: [
      { key: "client_id",     label: "Client ID",     placeholder: "CF_CLIENT_ID_XXXX" },
      { key: "client_secret", label: "Client Secret", isPassword: true, placeholder: "••••••••••••••••" },
      { key: "email",         label: "Account Email", placeholder: "you@company.com", isOptional: true },
    ],
  },
  {
    type: "payu",
    name: "PayU",
    description: "Payments and transaction history",
    icon: <LetterIcon letters="PU" bg="#EA5A0B" />,
    fields: [
      { key: "key",   label: "Merchant Key",  placeholder: "abcXYZ" },
      { key: "salt",  label: "Merchant Salt", isPassword: true, placeholder: "••••••••••••••••" },
      { key: "email", label: "Account Email", placeholder: "you@company.com", isOptional: true },
    ],
  },
  {
    type: "paytm",
    name: "Paytm",
    description: "Merchant transaction history",
    icon: <SiIcon slug="paytm" bg="#002970" />,
    fields: [
      { key: "merchant_id",  label: "Merchant ID",  placeholder: "YOURME12345678901234" },
      { key: "merchant_key", label: "Merchant Key", isPassword: true, placeholder: "••••••••••••••••" },
      { key: "email",        label: "Account Email", placeholder: "you@company.com", isOptional: true },
    ],
  },
  {
    type: "easebuzz",
    name: "Easebuzz",
    description: "Payments and transaction reports",
    icon: <LetterIcon letters="EB" bg="#7C3AED" />,
    fields: [
      { key: "key",   label: "API Key",  placeholder: "EasebuzzKey" },
      { key: "salt",  label: "API Salt", isPassword: true, placeholder: "••••••••••••••••" },
      { key: "email", label: "Account Email", placeholder: "you@company.com", isOptional: true },
    ],
  },
  {
    type: "bank_statement",
    name: "Bank Statement",
    description: "Upload bank statement CSV/Excel",
    icon: <LucideIcon bg="#1B3A5C" icon={<Landmark className="h-[18px] w-[18px] text-foreground" />} />,
    isCSV: true,
  },
  {
    type: "csv",
    name: "Generic CSV",
    description: "Upload any CSV with transactions",
    icon: <LucideIcon bg="#1A3A28" icon={<FileSpreadsheet className="h-[18px] w-[18px] text-foreground" />} />,
    isCSV: true,
  },
  {
    type: "google_sheets",
    name: "Google Sheets",
    description: "Live-sync a shared Google Sheet by link",
    icon: <SiIcon slug="googlesheets" bg="#0F9D58" />,
    fields: [
      { key: "sheet_url", label: "Google Sheet link", placeholder: "https://docs.google.com/spreadsheets/d/…" },
    ],
  },
  {
    type: "excel",
    name: "Excel (online)",
    description: "Live-sync an Excel file by share link",
    icon: <SiIcon slug="microsoftexcel" bg="#217346" />,
    fields: [
      { key: "file_url", label: "Excel file link", placeholder: "Public Google Drive / OneDrive / .xlsx link" },
    ],
  },
  {
    type: "app_store",
    name: "Apple App Store",
    description: "In-app purchase & subscription revenue via App Store Server Notifications",
    icon: <SiIcon slug="appstore" bg="#0D96F6" />,
    webhookPath: "/api/webhooks/app-store",
    fields: [
      { key: "bundle_id",    label: "Bundle ID",   placeholder: "com.yourcompany.app" },
      { key: "app_apple_id", label: "Apple App ID", placeholder: "1234567890 (App Store Connect → App Information)", isOptional: true },
    ],
  },
];

const CSV_COLUMN_OPTIONS = [
  { value: "", label: "— Ignore —" },
  { value: "date", label: "Transaction Date" },
  { value: "description", label: "Description" },
  { value: "amount", label: "Amount" },
  { value: "type", label: "Type (credit/debit)" },
  { value: "balance", label: "Running Balance" },
  { value: "reference", label: "Reference / ID" },
  { value: "counterparty", label: "Counterparty / Name" },
];

// ─── Sync date-range presets ──────────────────────────────────────────────────

// Backfill presets. `windows` ≈ how many 14-day background jobs the range becomes
// (JOB_WINDOW_DAYS in lib/connectors/jobs.ts) — shown so the user knows the size.
const SYNC_PRESETS = [
  { label: "Last 30 days",  days: 30,   windows: 3  },
  { label: "Last 90 days",  days: 90,   windows: 7  },
  { label: "Last 6 months", days: 180,  windows: 13 },
  { label: "Last 1 year",   days: 365,  windows: 27 },
  { label: "Last 2 years",  days: 730,  windows: 53 },
  { label: "Last 3 years",  days: 1095, windows: 79 },
] as const;

// API connectors with a dedicated sync route. Membership here means:
//  • "Sync latest" → incremental endpoint, and
//  • date-range backfill → durable background queue (not in-request chunking).
const SYNC_ENDPOINTS: Partial<Record<Connector["type"], string>> = {
  razorpay: "/api/connectors/razorpay",
  stripe:   "/api/connectors/stripe",
  cashfree: "/api/connectors/cashfree",
  payu:     "/api/connectors/payu",
  paytm:    "/api/connectors/paytm",
  easebuzz: "/api/connectors/easebuzz",
};

// Connectors whose volume requires the resumable queue (cursor-chunked) for BOTH
// backfill and "sync latest", rather than an inline request.
const RESUMABLE_CONNECTORS = new Set<Connector["type"]>(["stripe", "razorpay"]);

// Link connectors: live-sync a public URL (Google Sheet / online Excel) by
// re-reading + mirroring it. One simple "Sync now" action (no date range).
const LINK_CONNECTORS = new Set<Connector["type"]>(["google_sheets", "excel"]);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// A fetch that fails because the user navigated away (request aborted / tab
// switched) is NOT a sync failure — the backfill runs server-side regardless.
// Don't surface these as errors.
function isAbortError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "AbortError") return true;
  return e instanceof Error && /abort|Failed to fetch|NetworkError|Load failed/i.test(e.message);
}

/** A 2px line on a card's bottom edge. Determinate fills to `percent`; otherwise
 *  an indeterminate sweep while a quick sync runs. Renders nothing when idle. */
function SyncProgressBar({ determinate, percent, indeterminate }: {
  determinate: boolean; percent: number; indeterminate: boolean;
}) {
  if (!determinate && !indeterminate) return null;
  return (
    <div className="absolute inset-x-0 bottom-0 h-[2px] bg-primary/10" aria-hidden>
      {determinate ? (
        <div
          className="h-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(4, Math.min(100, percent))}%` }}
        />
      ) : (
        <div className="h-full w-2/5 rounded-full bg-primary/80 animate-[sync-sweep_1.1s_ease-in-out_infinite]" />
      )}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConnectorsClientProps {
  orgId: string;
  connectors: Connector[];
  /** Per-connector HMAC tokens generated server-side; sent with every sync request
   *  so the API route can skip Supabase cookie auth (3 network calls) and verify
   *  the token locally (0 network calls). */
  syncTokens?: Record<string, string>;
  /** Optional additional section (e.g. Cloud Drive connectors) rendered below the main grid */
  children?: React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectorsClient({ orgId, connectors, syncTokens = {}, children }: ConnectorsClientProps) {
  const [activeConnectors, setActiveConnectors] = React.useState<Connector[]>(connectors);

  // Modal state
  const [openModal, setOpenModal] = React.useState<ConnectorDef | null>(null);
  const [editingConnector, setEditingConnector] = React.useState<Connector | null>(null);

  // formValues persists across modal open/close — cleared only on confirm/cancel
  const [formValues, setFormValues] = React.useState<Record<string, string>>({});

  const [loading, setLoading] = React.useState(false);
  const [syncingId, setSyncingId] = React.useState<string | null>(null);
  // Progress is rendered as a filling bar (jobsProgress + syncingId); this state is
  // retained only so the existing sync handlers can keep writing without churn.
  const [, setSyncProgress] = React.useState<{ connectorId: string; current: number; total: number } | null>(null);
  const [disconnectingId, setDisconnectingId] = React.useState<string | null>(null);
  // Per-connector backfill progress (from sync_jobs), polled org-wide so the bar
  // is persistent — it shows ongoing backfills even after reload / cron-driven.
  const [jobsProgress, setJobsProgress] = React.useState<Record<string, { active: boolean; percent: number; remaining: number; processed: number }>>({});
  // Time-based catch-up % for the inline "Sync Latest" path (non-resumable
  // connectors). Gateways don't report a total count, so we show how far the
  // synced window has advanced from its start toward now — an honest proxy.
  const [incrementalPct, setIncrementalPct] = React.useState<Record<string, number>>({});
  // Connectors that just transitioned active→done — held briefly so the bar fills
  // to 100% and fades, instead of silently vanishing at ~95% (which read as "stuck").
  const [completedPulse, setCompletedPulse] = React.useState<Record<string, true>>({});
  const prevActiveRef = React.useRef<Record<string, boolean>>({});
  const [confirmRemove, setConfirmRemove] = React.useState<Connector | null>(null);

  // ── Custom date-range sync ─────────────────────────────────────────────────
  // Default range starts at the financial-year start (1 Apr) so a sync reconciles
  // the whole FY (refunds/disputes on older orders), not just the last 30 days.
  const todayStr = new Date().toISOString().split("T")[0];
  const defaultFrom = fyStartISO();
  const [customSyncConnector, setCustomSyncConnector] = React.useState<Connector | null>(null);
  const [customFrom, setCustomFrom] = React.useState(defaultFrom);
  const [customTo,   setCustomTo]   = React.useState(todayStr);

  const [csvFile, setCsvFile] = React.useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = React.useState<string[]>([]);
  const [csvMapping, setCsvMapping] = React.useState<Record<string, string>>({});

  // ── Draggable dialog ───────────────────────────────────────────────────────

  const [dialogPos, setDialogPos] = React.useState<{ x: number; y: number } | null>(null);
  const dialogContentRef = React.useRef<HTMLDivElement>(null);
  const dragOrigin = React.useRef<{ mouseX: number; mouseY: number; elemX: number; elemY: number } | null>(null);

  // Reset to center whenever a different modal opens
  React.useEffect(() => { setDialogPos(null); }, [openModal]);

  // Tracks whether this page is still mounted, so a backfill poll that's still
  // running when the user navigates away stops quietly instead of firing a stale
  // toast. (The sync itself runs server-side and is unaffected.)
  const mountedRef = React.useRef(true);
  React.useEffect(() => () => { mountedRef.current = false; }, []);

  // Poll org-wide backfill progress so each connector card shows a live filling
  // bar — persistently (survives reload, reflects cron-driven backfills). Polls
  // faster while something is active, slower when idle.
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async () => {
      let anyActive = false;
      try {
        const res = await fetch(`/api/connectors/jobs?org_id=${orgId}`);
        if (res.ok) {
          const data = await res.json() as { connectors?: Record<string, { active: boolean; percent: number; remaining: number; processed: number }> };
          const map = data.connectors ?? {};
          anyActive = Object.values(map).some((p) => p.active);
          if (!cancelled) {
            setJobsProgress(map);
            // Detect active→done per connector and pulse the bar to 100% briefly,
            // so completion is visible rather than the bar just disappearing.
            const prev = prevActiveRef.current;
            const next: Record<string, boolean> = {};
            for (const [id, p] of Object.entries(map)) next[id] = p.active;
            for (const id of Object.keys(prev)) {
              if (prev[id] && next[id] === false) {
                setCompletedPulse((c) => ({ ...c, [id]: true }));
                setTimeout(() => {
                  if (mountedRef.current) setCompletedPulse((c) => { const n = { ...c }; delete n[id]; return n; });
                }, 2000);
              }
            }
            prevActiveRef.current = next;
          }
        }
      } catch { /* transient — keep last known */ }
      if (!cancelled) timer = setTimeout(tick, anyActive ? 2500 : 8000);
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orgId]);

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't steal clicks on interactive children (buttons, inputs)
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
    e.preventDefault();

    const el = dialogContentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    dragOrigin.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elemX: rect.left,
      elemY: rect.top,
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragOrigin.current || !dialogContentRef.current) return;
      const dx = ev.clientX - dragOrigin.current.mouseX;
      const dy = ev.clientY - dragOrigin.current.mouseY;
      const W = dialogContentRef.current.offsetWidth;
      const H = dialogContentRef.current.offsetHeight;
      setDialogPos({
        x: Math.max(8, Math.min(window.innerWidth  - W - 8, dragOrigin.current.elemX + dx)),
        y: Math.max(8, Math.min(window.innerHeight - H - 8, dragOrigin.current.elemY + dy)),
      });
    };

    const onUp = () => {
      dragOrigin.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const getConnectorsOfType = (type: Connector["type"]) =>
    activeConnectors.filter((c) => c.type === type);

  const defFor = (type: Connector["type"]) =>
    CONNECTOR_DEFS.find((d) => d.type === type)!;

  // ── Open for new connection ────────────────────────────────────────────────
  const handleOpenNew = (def: ConnectorDef) => {
    setEditingConnector(null);
    setOpenModal(def);
    const existingCount = getConnectorsOfType(def.type).length;
    setFormValues({
      name: existingCount === 0 ? def.name : `${def.name} ${existingCount + 1}`,
    });
    setCsvFile(null);
    setCsvHeaders([]);
    setCsvMapping({});
  };

  // ── Open for editing an existing connector ─────────────────────────────────
  const handleOpenEdit = (inst: Connector) => {
    const def = defFor(inst.type);
    setEditingConnector(inst);
    setOpenModal(def);
    const cfg = (inst.config ?? {}) as Record<string, string>;
    // Pre-fill all non-password fields; leave password fields blank
    // (user can leave blank = keep existing secret)
    const prefilled: Record<string, string> = { name: inst.name };
    for (const field of def.fields ?? []) {
      if (!field.isPassword) {
        prefilled[field.key] = cfg[field.key] ?? "";
      }
      // Password fields intentionally left blank — placeholder explains
    }
    setFormValues(prefilled);
  };

  const handleCloseModal = () => {
    setOpenModal(null);
    setEditingConnector(null);
  };

  // ── CSV upload ─────────────────────────────────────────────────────────────
  const handleCSVUpload = async (file: File) => {
    setCsvFile(file);
    const text = await file.text();
    const firstLine = text.split("\n")[0];
    const headers = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    setCsvHeaders(headers);

    const autoMap: Record<string, string> = {};
    headers.forEach((h) => {
      const lower = h.toLowerCase();
      if (lower.includes("date")) autoMap[h] = "date";
      else if (lower.includes("desc") || lower.includes("narr") || lower.includes("particular"))
        autoMap[h] = "description";
      else if (lower.includes("amount") || lower.includes("amt")) autoMap[h] = "amount";
      else if (lower.includes("type") || lower.includes("cr/dr")) autoMap[h] = "type";
      else if (lower.includes("balance") || lower.includes("bal")) autoMap[h] = "balance";
      else if (lower.includes("ref") || lower.includes("id")) autoMap[h] = "reference";
      else if (lower.includes("name") || lower.includes("party")) autoMap[h] = "counterparty";
    });
    setCsvMapping(autoMap);
  };

  // ── Connect (create) or Save (edit) ────────────────────────────────────────
  const handleSave = async () => {
    if (!openModal) return;
    setLoading(true);

    try {
      // ── CSV import ──
      if (openModal.isCSV) {
        if (!csvFile) { toast.error("Please upload a file first"); setLoading(false); return; }
        const formData = new FormData();
        formData.append("file", csvFile);
        formData.append("type", openModal.type);
        formData.append("org_id", orgId);
        formData.append("mapping", JSON.stringify(csvMapping));
        const res = await fetch("/api/connectors/csv", { method: "POST", body: formData });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
        }
        const data = await res.json();
        toast.success(`Imported ${data.imported ?? 0} transactions`);
        handleCloseModal();
        setLoading(false);
        return;
      }

      const { name: connectorName, ...credFields } = formValues;

      if (editingConnector) {
        // ── PATCH: update existing connector ──
        // Only include password fields if the user typed something
        const def = defFor(editingConnector.type);
        const existingCfg = (editingConnector.config ?? {}) as Record<string, string>;
        const updatedCfg: Record<string, string> = { ...existingCfg };

        for (const field of def.fields ?? []) {
          const val = credFields[field.key];
          if (field.isPassword || !field.isOptional) {
            // Required fields (passwords + non-optional plain text like key_id):
            // only overwrite if the user typed something non-empty.
            // Blank = keep existing — prevents accidental credential wipe on edit.
            if (val && val.trim()) updatedCfg[field.key] = val.trim();
          } else {
            // Optional fields (email, mid, account_number, etc.):
            // always update — user can explicitly clear them.
            if (val !== undefined) updatedCfg[field.key] = val;
          }
        }

        const res = await fetch(`/api/connectors/manage?id=${editingConnector.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: connectorName?.trim() || editingConnector.name,
            config: updatedCfg,
            status: "active",
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
        }
        const updated = await res.json();
        setActiveConnectors((prev) =>
          prev.map((c) => (c.id === editingConnector.id ? updated : c))
        );
        toast.success("Connector updated");
      } else {
        // ── POST: create new connector ──
        const res = await fetch("/api/connectors/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            org_id: orgId,
            type: openModal.type,
            name: connectorName?.trim() || openModal.name,
            config: credFields,
            status: "active",
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
        }
        const connector = await res.json();
        setActiveConnectors((prev) => [...prev, connector]);
        toast.success(`${connectorName || openModal.name} connected`);
        // Link connectors (Google Sheets / Excel): pull data immediately so the
        // user sees it work, instead of waiting for the next cron.
        if (LINK_CONNECTORS.has(connector.type)) {
          handleCloseModal();
          await handleLinkSync(connector);
          return;
        }
      }

      handleCloseModal();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  // ── Date-range backfill ───────────────────────────────────────────────────
  // For API connectors this enqueues bounded background jobs (Pillar 2) and polls
  // progress — timeout-proof regardless of range size or volume. Other connectors
  // fall back to the one-shot /api/sync route.
  const handleSync = async (connector: Connector, fromDate: Date, toDate: Date) => {
    setSyncingId(connector.id);

    try {
      if (connector.type in SYNC_ENDPOINTS) {
        const res = await fetch("/api/connectors/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connector_id: connector.id,
            org_id: orgId,
            from_date: fromDate.toISOString(),
            to_date:   toDate.toISOString(),
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
        }
        const { enqueued } = await res.json() as { enqueued: number };
        if (!enqueued) {
          toast.success("You're all caught up — nothing new to sync.");
          return;
        }
        toast.message("Syncing your data — this runs in the background, you can keep working.");
        await pollBackfill(connector.id);
        return;
      }

      // ── Fallback for connectors without a dedicated route ────────────
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      setActiveConnectors((prev) =>
        prev.map((c) => (c.id === connector.id ? { ...c, last_synced_at: new Date().toISOString() } : c))
      );
      toast.success(`Synced ${data.total_inserted ?? 0} new, refreshed ${data.total_updated ?? 0}`);
    } catch (err) {
      if (!isAbortError(err)) toast.error(`Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncingId(null);
      setSyncProgress(null);
    }
  };

  // Poll the backfill queue until it drains, surfacing live progress. Resilient by
  // design: a single failed/aborted poll (e.g. navigating away) is never treated
  // as a sync failure — the jobs run server-side regardless. Stops silently if the
  // page unmounts; the persistent bars + top-bar indicator keep showing progress.
  const pollBackfill = async (connectorId: string) => {
    const POLL_MS = 2500;
    const MAX_POLLS = 480; // ~20 min ceiling; jobs keep running server-side regardless
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_MS);
      if (!mountedRef.current) return; // navigated away — bars keep tracking it
      let j: { done: number; failed: number; total: number; remaining: number; active: boolean } | null = null;
      try {
        const res = await fetch(`/api/connectors/jobs?connector_id=${connectorId}&org_id=${orgId}`);
        if (!res.ok) continue;
        j = await res.json();
      } catch {
        continue; // transient/aborted poll — retry; the backfill is still running
      }
      if (!j) continue;
      if (!mountedRef.current) return;
      setSyncProgress({ connectorId, current: j.done + j.failed, total: j.total });
      if (!j.active) {
        setActiveConnectors((prev) =>
          prev.map((c) => (c.id === connectorId ? { ...c, last_synced_at: new Date().toISOString() } : c))
        );
        if (j.failed > 0) {
          // Don't alarm with raw "failed" counts — unfinished pieces retry on
          // their own in the background (and often the data is already in).
          toast.message("Synced — a few items are still catching up in the background.");
        } else {
          toast.success("Your data's up to date.");
        }
        return;
      }
    }
  };

  // ── Incremental "sync latest" ─────────────────────────────────────────────
  // Server picks the window from the connector's checkpoint and advances it.
  // We loop bounded steps until caught up — each step is small and timeout-proof,
  // so this stays fast no matter how far behind (or how many connectors) we have.
  // Live-sync a link connector (Google Sheets / online Excel): re-read the URL
  // and mirror it. No date range — the whole sheet IS the dataset.
  const handleLinkSync = async (connector: Connector) => {
    setSyncingId(connector.id);
    try {
      const res = await fetch("/api/connectors/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector_id: connector.id, org_id: orgId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error((b as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json() as { synced?: number; fetched?: number; warning?: string };
      setActiveConnectors((prev) =>
        prev.map((c) => (c.id === connector.id ? { ...c, last_synced_at: new Date().toISOString() } : c))
      );
      if (data.warning) toast.warning(data.warning);
      else toast.success(`Synced ${data.synced ?? 0} row${data.synced === 1 ? "" : "s"} from the link`);
    } catch (err) {
      if (!isAbortError(err)) toast.error(`Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncingId(null);
    }
  };

  const handleIncrementalSync = async (connector: Connector) => {
    const endpoint = SYNC_ENDPOINTS[connector.type];
    if (!endpoint) return;

    // High-volume connectors catch up on the resumable queue (bounded cursor
    // chunks) instead of an inline loop that could time out. Enqueue + poll.
    if (RESUMABLE_CONNECTORS.has(connector.type)) {
      setSyncingId(connector.id);
      try {
        const res = await fetch("/api/connectors/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connector_id: connector.id, org_id: orgId, incremental: true }),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => null);
          throw new Error((b as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
        }
        const { enqueued } = await res.json() as { enqueued: number };
        if (!enqueued) { toast.success("Already syncing — catching up in the background."); return; }
        toast.message("Catching up on the latest — running in the background…");
        await pollBackfill(connector.id);
      } catch (err) {
        if (!isAbortError(err)) toast.error(`Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setSyncingId(null);
        setSyncProgress(null);
      }
      return;
    }

    setSyncingId(connector.id);
    setIncrementalPct((p) => ({ ...p, [connector.id]: 2 }));
    try {
      let totalSynced = 0;
      let totalUpdated = 0;
      let hasMore = true;
      let step = 0;
      let anchorMs: number | null = null; // start of the first window — the 0% mark
      const MAX_STEPS = 40; // safety cap; each step is bounded server-side
      const warnSet = new Set<string>();

      while (hasMore && step < MAX_STEPS) {
        step++;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connector_id: connector.id,
            org_id: orgId,
            mode: "incremental",
            sync_token: syncTokens[connector.id],
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(errBody.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as {
          synced?: number; updated?: number; has_more?: boolean; warnings?: string[];
          from?: string; to?: string;
        };
        totalSynced += data.synced ?? 0;
        totalUpdated += data.updated ?? 0;
        (data.warnings ?? []).forEach((w) => warnSet.add(w));
        hasMore = !!data.has_more;

        // Time-based catch-up %: how far the synced window's forward edge (`to`)
        // has advanced from the first window's start (`from`) toward now.
        if (data.from && data.to) {
          if (anchorMs == null) anchorMs = Date.parse(data.from);
          const toMs = Date.parse(data.to);
          const span = Date.now() - anchorMs;
          const pct = span > 0 ? ((toMs - anchorMs) / span) * 100 : 100;
          setIncrementalPct((p) => ({
            ...p,
            [connector.id]: hasMore ? Math.min(99, Math.max(2, pct)) : 100,
          }));
        }
      }

      setActiveConnectors((prev) =>
        prev.map((c) =>
          c.id === connector.id ? { ...c, last_synced_at: new Date().toISOString() } : c
        )
      );

      // Hold at 100% briefly so the bar visibly completes instead of vanishing.
      setIncrementalPct((p) => ({ ...p, [connector.id]: 100 }));
      setTimeout(() => setIncrementalPct((p) => {
        const n = { ...p }; delete n[connector.id]; return n;
      }), 1000);

      if (warnSet.size > 0) {
        const reason = Array.from(warnSet)[0];
        toast.warning(`Synced ${totalSynced} new, refreshed ${totalUpdated} · ${warnSet.size} warning${warnSet.size > 1 ? "s" : ""} — ${reason}`);
      } else {
        toast.success(`Up to date — ${totalSynced} new, ${totalUpdated} refreshed`);
      }
    } catch (err) {
      setIncrementalPct((p) => { const n = { ...p }; delete n[connector.id]; return n; });
      if (!isAbortError(err)) toast.error(`Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncingId(null);
      setSyncProgress(null);
    }
  };

  // ── Disconnect ─────────────────────────────────────────────────────────────
  const handleDisconnect = async (connectorId: string) => {
    setConfirmRemove(null);
    setDisconnectingId(connectorId);
    try {
      const res = await fetch(`/api/connectors/manage?id=${connectorId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to disconnect");
      }
      setActiveConnectors((prev) => prev.filter((c) => c.id !== connectorId));
      toast.success("Connector removed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to disconnect");
    } finally {
      setDisconnectingId(null);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  // ── Split defs by connection state ───────────────────────────────────────────
  const connectedDefs    = CONNECTOR_DEFS.filter((d) => getConnectorsOfType(d.type).length > 0);
  const notConnectedDefs = CONNECTOR_DEFS.filter((d) => getConnectorsOfType(d.type).length === 0);
  const hasAnySplit      = connectedDefs.length > 0;

  /** Renders a single connector card by its def */
  const renderCard = (def: ConnectorDef, i: number) => {
    const instances = getConnectorsOfType(def.type);
    const hasActive = instances.some((c) => c.status === "active");

    return (
      <div
        key={def.type}
        className={cn(
          "relative rounded-2xl border bg-card p-5 flex flex-col gap-4 transition-all duration-200 hover:border-border shadow-[0_1px_3px_rgba(0,0,0,0.4)]",
          hasActive
            ? "border-emerald-500/20 shadow-[0_0_20px_hsl(158_64%_48%/0.08)]"
            : "border-border/60"
        )}
        style={{ animationDelay: `${i * 0.04}s` }}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          {def.icon}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{def.name}</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5 leading-relaxed">{def.description}</p>
          </div>
          {hasActive && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_hsl(158_64%_48%/0.8)]" />
              <span className="text-[10px] text-success/70 font-medium">Live</span>
            </div>
          )}
        </div>

        {/* Connected instances */}
        {instances.length > 0 && (
          <div className="space-y-1.5">
            {instances.map((inst) => {
              const cfg = (inst.config ?? {}) as Record<string, string>;
              // Show only the account email — never the API key/secret identifier.
              const subtitle = cfg.email
                || (inst.last_synced_at ? `Synced ${formatDate(inst.last_synced_at)}` : "Never synced");

              // Unified sync progress. Queued backfills report a job-level % (which
              // can sit at 0 while one big window is mid-flight) plus a live count of
              // rows pulled; inline "Sync Latest" reports a time-based catch-up %.
              const jp = jobsProgress[inst.id];
              const pulse = !!completedPulse[inst.id];
              const backfillActive = !!jp?.active;
              const incrPct = incrementalPct[inst.id];
              const determinatePct = pulse
                ? 100
                : backfillActive && jp!.percent > 0
                ? jp!.percent
                : incrPct != null
                ? incrPct
                : null;
              // While a backfill is genuinely working but still at 0% (no whole
              // window done yet), show the live rows-synced count so it never looks
              // frozen, and sweep the bar instead of leaving it dead at 0.
              const processed = jp?.processed ?? 0;
              const progressLabel = determinatePct != null
                ? `${Math.round(determinatePct)}%`
                : backfillActive
                ? (processed > 0
                    ? `${new Intl.NumberFormat("en-US", { notation: "compact" }).format(processed)} synced`
                    : "syncing…")
                : null;
              const showSweep = determinatePct == null && (backfillActive || syncingId === inst.id);

              const isConfirming = confirmRemove?.id === inst.id;

              return (
                <div
                  key={inst.id}
                  className={cn(
                    "relative overflow-hidden rounded-xl border transition-all",
                    inst.status === "error"
                      ? "border-red-500/20 bg-red-500/[0.04]"
                      : isConfirming
                      ? "border-red-500/30 bg-red-500/[0.06]"
                      : "border-border bg-accent/40"
                  )}
                >
                  {!isConfirming ? (
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-muted-foreground truncate">{inst.name}</p>
                        <p className="text-[10px] text-muted-foreground/70 truncate font-mono">{subtitle}</p>
                      </div>
                      {progressLabel && (
                        <span className="text-[10px] font-semibold text-primary tabular-nums flex-shrink-0 whitespace-nowrap" title="Sync progress">
                          {progressLabel}
                        </span>
                      )}
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => handleOpenEdit(inst)} title="Edit credentials"
                          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-all">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {LINK_CONNECTORS.has(inst.type) ? (
                          <button
                            onClick={() => handleLinkSync(inst)}
                            disabled={syncingId === inst.id}
                            title="Sync now — re-read the link"
                            className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-all disabled:opacity-60"
                          >
                            <RefreshCw className={cn("h-3.5 w-3.5", syncingId === inst.id && "animate-spin")} />
                          </button>
                        ) : (
                          <SyncDropdown
                            connector={inst}
                            isSyncing={syncingId === inst.id}
                            onSync={(from, to) => handleSync(inst, from, to)}
                            onSyncLatest={() => handleIncrementalSync(inst)}
                            onCustom={() => {
                              setCustomFrom(defaultFrom);
                              setCustomTo(todayStr);
                              setCustomSyncConnector(inst);
                            }}
                          />
                        )}
                        <button onClick={() => setConfirmRemove(inst)} disabled={disconnectingId === inst.id}
                          title="Remove"
                          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-red-500/[0.08] transition-all disabled:opacity-40">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-3 py-2.5 space-y-2">
                      <p className="text-[11px] text-destructive/90 leading-snug">
                        Remove <span className="font-semibold">{inst.name}</span> and all its synced transactions?
                      </p>
                      <div className="flex gap-1.5">
                        <button onClick={() => setConfirmRemove(null)}
                          className="flex-1 text-[11px] font-medium text-muted-foreground hover:text-muted-foreground bg-accent/40 hover:bg-accent border border-border rounded-lg py-1 transition-all">
                          Cancel
                        </button>
                        <button onClick={() => handleDisconnect(inst.id)} disabled={disconnectingId === inst.id}
                          className="flex-1 text-[11px] font-medium text-destructive hover:text-destructive bg-red-500/[0.1] hover:bg-red-500/[0.18] border border-red-500/20 rounded-lg py-1 transition-all disabled:opacity-50">
                          {disconnectingId === inst.id ? "Removing…" : "Yes, remove"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Live sync progress — a filling line on the card's bottom edge.
                      Determinate (fills to %) for queued backfills; indeterminate
                      sweep for quick inline syncs (link / "sync latest"). */}
                  <SyncProgressBar
                    determinate={determinatePct != null}
                    percent={determinatePct ?? 0}
                    indeterminate={showSweep}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Add / Connect button */}
        {!def.isCSV ? (
          <Button size="sm" variant={instances.length > 0 ? "outline" : "default"}
            className={cn("gap-1.5 w-full transition-all",
              instances.length > 0 && "border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border")}
            onClick={() => handleOpenNew(def)}>
            {instances.length > 0
              ? <><Plus className="h-3.5 w-3.5" /> Add Account</>
              : <><Zap className="h-3.5 w-3.5" /> Connect</>}
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5 w-full" onClick={() => handleOpenNew(def)}>
            <Upload className="h-3.5 w-3.5" /> Upload File
          </Button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="animate-enter">
        <h1 className="text-xl font-bold text-foreground">Connectors</h1>
        <p className="text-sm text-muted-foreground/70 mt-0.5">
          Connect payment gateways, accounting tools, and cloud storage — multiple accounts per source supported
        </p>
      </div>

      {/* ── Connected ──────────────────────────────────────────────────────── */}
      {hasAnySplit && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_hsl(158_64%_48%/0.8)]" />
            <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-success/60">
              Connected ({connectedDefs.length})
            </span>
            <div className="flex-1 h-px bg-accent/40" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {connectedDefs.map((def, i) => renderCard(def, i))}
          </div>
        </div>
      )}

      {/* ── Not connected ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {hasAnySplit && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-accent/40" />
            <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70">
              Not connected ({notConnectedDefs.length})
            </span>
            <div className="flex-1 h-px bg-accent/40" />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {notConnectedDefs.map((def, i) => renderCard(def, i))}
        </div>
      </div>

      {/* ── Cloud storage section (injected from page.tsx) ─────────────────── */}
      {children && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-accent/40" />
            <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70">
              Cloud Storage
            </span>
            <div className="flex-1 h-px bg-accent/40" />
          </div>
          <p className="text-xs text-muted-foreground/70">
            Store raw transaction files in Google Drive or OneDrive — Finance OS fetches them automatically,
            normalises columns with AI, and keeps data in sync.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {children}
          </div>
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      <Dialog.Root open={!!openModal} onOpenChange={(open) => !open && handleCloseModal()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md animate-fade-in" />

          {/* Draggable dialog — positioning via inline style so we can switch between
              centered (null) and free-floating (pixel coords) without class conflicts */}
          <Dialog.Content
            ref={dialogContentRef}
            className="fixed z-[201] w-[calc(100vw-32px)] max-w-[460px] bg-popover border border-border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.75)] focus:outline-none animate-scale-in flex flex-col"
            style={
              dialogPos
                // Dragging: explicit pixel position, clear inset constraints
                ? { top: dialogPos.y, left: dialogPos.x, right: "auto", bottom: "auto", margin: 0, maxHeight: "calc(100vh - 32px)" }
                // Centered: inset:0 + margin:auto — doesn't use transform, so animation can't clobber it
                : { top: 0, left: 0, right: 0, bottom: 0, margin: "auto", maxHeight: "calc(100vh - 32px)" }
            }
          >
            {/* ── Drag-handle header ─────────────────────────────────────── */}
            <div
              className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0 cursor-grab active:cursor-grabbing select-none border-b border-border"
              onMouseDown={handleDragStart}
            >
              <div className="flex items-start gap-2.5">
                <GripVertical className="h-4 w-4 text-muted-foreground/70 mt-0.5 flex-shrink-0" />
                <div>
                  <Dialog.Title className="text-[14px] font-semibold text-foreground leading-snug">
                    {editingConnector
                      ? `Edit ${openModal?.name}`
                      : openModal?.isCSV
                      ? `Upload ${openModal?.name}`
                      : `Connect ${openModal?.name}`}
                  </Dialog.Title>
                  {editingConnector && (
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                      Leave password fields blank to keep existing credentials
                    </p>
                  )}
                </div>
              </div>
              {/* stopPropagation so clicking × doesn't start a drag */}
              <Dialog.Close asChild>
                <button
                  className="text-muted-foreground/70 hover:text-muted-foreground transition-colors rounded-lg p-1.5 hover:bg-accent flex-shrink-0"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* ── Scrollable body ────────────────────────────────────────── */}
            <div className="px-5 py-4 overflow-y-auto flex-1">
              {openModal?.isCSV ? (
                <CSVUploadForm
                  csvFile={csvFile}
                  csvHeaders={csvHeaders}
                  csvMapping={csvMapping}
                  onFileChange={handleCSVUpload}
                  onMappingChange={setCsvMapping}
                />
              ) : (
                <div className="space-y-3">
                  {/* Account label */}
                  <FormField
                    label="Account Label"
                    placeholder={`e.g. ${openModal?.name} Production`}
                    value={formValues.name ?? ""}
                    onChange={(v) => setFormValues((p) => ({ ...p, name: v }))}
                  />

                  {/* Credentials divider */}
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-px bg-accent/40" />
                    <span className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Credentials</span>
                    <div className="flex-1 h-px bg-accent/40" />
                  </div>

                  {/* Required credential fields */}
                  {openModal?.fields?.filter((f) => !f.isOptional).map((field) => (
                    <FormField
                      key={field.key}
                      label={field.label}
                      type={field.isPassword ? "password" : "text"}
                      placeholder={
                        editingConnector
                          ? "Leave blank to keep existing"
                          : field.placeholder
                      }
                      value={formValues[field.key] ?? ""}
                      onChange={(v) => setFormValues((p) => ({ ...p, [field.key]: v }))}
                    />
                  ))}

                  {/* Optional fields */}
                  {openModal?.fields?.some((f) => f.isOptional) && (
                    <>
                      <div className="flex items-center gap-2 py-1">
                        <div className="flex-1 h-px bg-accent/40" />
                        <span className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Optional info</span>
                        <div className="flex-1 h-px bg-accent/40" />
                      </div>
                      {openModal?.fields?.filter((f) => f.isOptional).map((field) => (
                        <FormField
                          key={field.key}
                          label={field.label}
                          placeholder={field.placeholder}
                          value={formValues[field.key] ?? ""}
                          onChange={(v) => setFormValues((p) => ({ ...p, [field.key]: v }))}
                        />
                      ))}
                    </>
                  )}

                  {/* Webhook-only connector: show the endpoint URL to register with the provider. */}
                  {openModal?.webhookPath && (
                    <div className="rounded-lg border border-border bg-accent/30 p-3 space-y-1.5">
                      <p className="text-[11px] font-semibold text-foreground uppercase tracking-wide">Webhook setup</p>
                      <p className="text-xs text-muted-foreground/80 leading-relaxed">
                        In App Store Connect → your app → <span className="text-foreground">App Information → App Store Server Notifications</span>, set the <span className="text-foreground">Version 2</span> Production (and Sandbox) URL to:
                      </p>
                      <code className="block text-[11px] break-all rounded bg-background/60 border border-border px-2 py-1.5 text-foreground select-all">
                        {(typeof window !== "undefined" ? window.location.origin : "")}{openModal.webhookPath}
                      </code>
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                        No secret needed — notifications are verified against Apple&apos;s certificate. Revenue appears in real time as customers subscribe, renew, and refund.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Sticky footer — always visible ─────────────────────────── */}
            <div className="flex gap-2.5 px-5 pb-5 pt-4 border-t border-border flex-shrink-0">
              <Dialog.Close asChild>
                <Button
                  variant="outline"
                  className="flex-1 border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border"
                >
                  Cancel
                </Button>
              </Dialog.Close>
              <Button className="flex-1" onClick={handleSave} disabled={loading}>
                {loading ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {editingConnector ? "Saving…" : openModal?.isCSV ? "Importing…" : "Connecting…"}
                  </>
                ) : editingConnector ? "Save Changes"
                  : openModal?.isCSV ? "Import"
                  : "Connect"
                }
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* ── Custom date-range sync dialog ───────────────────────────────── */}
      <Dialog.Root
        open={!!customSyncConnector}
        onOpenChange={(open) => !open && setCustomSyncConnector(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md animate-fade-in" />
          <Dialog.Content
            className="fixed z-[201] w-[calc(100vw-32px)] max-w-[400px] bg-popover border border-border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.75)] focus:outline-none animate-scale-in flex flex-col"
            style={{ top: 0, left: 0, right: 0, bottom: 0, margin: "auto", maxHeight: "calc(100vh - 32px)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0 border-b border-border">
              <div>
                <Dialog.Title className="text-[14px] font-semibold text-foreground">
                  Custom Sync Range
                </Dialog.Title>
                {customSyncConnector && (
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">{customSyncConnector.name}</p>
                )}
              </div>
              <Dialog.Close asChild>
                <button className="text-muted-foreground/70 hover:text-muted-foreground transition-colors rounded-lg p-1.5 hover:bg-accent">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              {/* Date range */}
              <div>
                <label className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70 block mb-1.5">
                  Date range
                </label>
                <DateRangePicker
                  from={customFrom}
                  to={customTo}
                  max={todayStr}
                  onChange={(f, t) => { setCustomFrom(f); setCustomTo(t); }}
                  className="w-full justify-start"
                />
              </div>

              {/* Live estimate */}
              {customFrom && customTo && customFrom <= customTo && (() => {
                const days = Math.ceil(
                  (new Date(customTo).getTime() - new Date(customFrom).getTime()) / (1000 * 60 * 60 * 24)
                ) + 1;
                const chunks = Math.ceil(days / 30);
                return (
                  <div
                    className="rounded-xl px-3.5 py-3 flex items-center justify-between"
                    style={{ background: "rgba(124,82,240,0.07)", border: "1px solid rgba(124,82,240,0.12)" }}
                  >
                    <div>
                      <p className="text-[11px] text-muted-foreground">
                        <span className="text-muted-foreground font-semibold num">{days}</span> days selected
                      </p>
                      <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">Duplicates skipped automatically</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[18px] font-bold text-primary/80 num leading-none">{chunks}</p>
                      <p className="text-[10px] text-muted-foreground/70 mt-0.5">request{chunks !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Validation warning */}
              {customFrom && customTo && customFrom > customTo && (
                <p className="text-[11px] text-destructive/80 flex items-center gap-1.5">
                  <span>⚠</span> &quot;From&quot; date must be before &quot;To&quot; date
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-2.5 px-5 pb-5 pt-4 border-t border-border flex-shrink-0">
              <Dialog.Close asChild>
                <Button
                  variant="outline"
                  className="flex-1 border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border"
                >
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                className="flex-1"
                disabled={!customFrom || !customTo || customFrom > customTo || syncingId === customSyncConnector?.id}
                onClick={() => {
                  if (!customSyncConnector || !customFrom || !customTo) return;
                  handleSync(customSyncConnector, new Date(customFrom), new Date(customTo + "T23:59:59"));
                  setCustomSyncConnector(null);
                }}
              >
                {syncingId === customSyncConnector?.id ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Syncing…</>
                ) : "Start Sync"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

// ─── Sync dropdown ────────────────────────────────────────────────────────────

interface SyncDropdownProps {
  connector: Connector;
  isSyncing: boolean;
  onSync: (from: Date, to: Date) => void;
  onSyncLatest: () => void;
  onCustom: () => void;
}

function SyncDropdown({ isSyncing, onSync, onSyncLatest, onCustom }: SyncDropdownProps) {
  // Progress is now shown as a filling bar on the card edge; the trigger just
  // spins while a sync is in flight.
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          disabled={isSyncing}
          title={isSyncing ? "Syncing…" : "Sync — choose date range"}
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-all disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isSyncing && "animate-spin")} />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-[300] rounded-xl overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.7)]"
          style={{
            background: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            minWidth: 200,
          }}
          align="end"
          sideOffset={6}
        >
          {/* Primary action — incremental, server-driven, always fast */}
          <DropdownMenu.Item
            className="flex items-center gap-2 px-3 py-2.5 text-[12px] font-medium text-foreground hover:bg-accent cursor-pointer outline-none transition-colors"
            onSelect={onSyncLatest}
          >
            <RefreshCw className="h-3.5 w-3.5 text-primary/80" />
            <span>Sync latest changes</span>
          </DropdownMenu.Item>

          {/* Header */}
          <div className="px-3 py-2 border-y border-border">
            <p className="text-[9.5px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70">
              Backfill date range
            </p>
          </div>

          {/* Presets */}
          {SYNC_PRESETS.map((preset) => (
            <DropdownMenu.Item
              key={preset.days}
              className="flex items-center justify-between px-3 py-2.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer outline-none transition-colors"
              onSelect={() => {
                const to = new Date();
                const from = new Date(to.getTime() - preset.days * 24 * 60 * 60 * 1000);
                onSync(from, to);
              }}
            >
              <span>{preset.label}</span>
              <span className="text-[10px] text-muted-foreground/70 ml-6 tabular-nums">
~{preset.windows} window{preset.windows > 1 ? "s" : ""}
              </span>
            </DropdownMenu.Item>
          ))}

          {/* Custom range */}
          <DropdownMenu.Separator className="h-px bg-accent/40 my-0.5" />
          <DropdownMenu.Item
            className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-primary/60 hover:text-primary hover:bg-primary/[0.06] cursor-pointer outline-none transition-colors"
            onSelect={onCustom}
          >
            <span>Custom range…</span>
          </DropdownMenu.Item>

          {/* Footer note */}
          <div className="px-3 py-2 border-t border-border">
            <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
              &ldquo;Sync latest&rdquo; fetches only new activity since the last sync.
              <br />Use backfill to load older history. Duplicates are skipped.
            </p>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// ─── Form field ───────────────────────────────────────────────────────────────

function FormField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <Input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-border bg-accent/40 text-foreground placeholder:text-muted-foreground/70 focus:border-primary/30 focus:ring-primary/20"
      />
    </div>
  );
}

// ─── CSV upload form ──────────────────────────────────────────────────────────

interface CSVUploadFormProps {
  csvFile: File | null;
  csvHeaders: string[];
  csvMapping: Record<string, string>;
  onFileChange: (file: File) => void;
  onMappingChange: (mapping: Record<string, string>) => void;
}

function CSVUploadForm({ csvFile, csvHeaders, csvMapping, onFileChange, onMappingChange }: CSVUploadFormProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all duration-200",
          csvFile
            ? "border-emerald-500/30 bg-emerald-500/[0.06]"
            : "border-border hover:border-primary/30 hover:bg-primary/[0.03]"
        )}
      >
        {csvFile ? (
          <div className="flex flex-col items-center gap-1.5">
            <CheckCircle2 className="h-6 w-6 text-success mb-1" />
            <p className="text-sm font-medium text-muted-foreground">{csvFile.name}</p>
            <p className="text-xs text-muted-foreground/70">{(csvFile.size / 1024).toFixed(1)} KB · Click to change</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload className="h-6 w-6 text-muted-foreground/70 mb-1" />
            <p className="text-sm font-medium text-muted-foreground">Click to upload CSV</p>
            <p className="text-xs text-muted-foreground/70">CSV, XLS, XLSX accepted</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChange(f); }} />
      </div>

      {csvHeaders.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Column Mapping</p>
          <p className="text-xs text-muted-foreground/70 mb-3">
            Auto-detected {Object.values(csvMapping).filter(Boolean).length} of {csvHeaders.length} columns.
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {csvHeaders.map((header) => (
              <div key={header} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground/70 w-28 truncate flex-shrink-0 font-mono bg-accent/40 border border-border px-1.5 py-0.5 rounded-md">
                  {header}
                </span>
                <span className="text-xs text-muted-foreground/70">→</span>
                <select
                  value={csvMapping[header] ?? ""}
                  onChange={(e) => onMappingChange({ ...csvMapping, [header]: e.target.value })}
                  className="flex-1 text-xs rounded-lg border border-border bg-accent/40 text-muted-foreground px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  {CSV_COLUMN_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-popover">{opt.label}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
