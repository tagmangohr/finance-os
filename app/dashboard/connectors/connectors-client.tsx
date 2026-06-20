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
import { cn, formatDate } from "@/lib/utils";
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

// Client sends 30-day windows; the server sub-chunks internally into 7-day
// Razorpay calls, so each Vercel function is fast (~3 s) regardless of data volume.
const SYNC_PRESETS = [
  { label: "Last 30 days",  days: 30,   chunks: 1  },
  { label: "Last 90 days",  days: 90,   chunks: 3  },
  { label: "Last 6 months", days: 180,  chunks: 6  },
  { label: "Last 1 year",   days: 365,  chunks: 13 },
  { label: "Last 2 years",  days: 730,  chunks: 25 },
  { label: "Last 3 years",  days: 1095, chunks: 37 },
] as const;

const CHUNK_DAYS = 30;

/** Split [from, to] into N-day client chunks. */
function splitDateRange(from: Date, to: Date, chunkDays = CHUNK_DAYS): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(from);
  const chunkMs = chunkDays * 24 * 60 * 60 * 1000;
  while (cursor < to) {
    const end = new Date(Math.min(cursor.getTime() + chunkMs, to.getTime()));
    chunks.push({ from: new Date(cursor), to: end });
    cursor = new Date(end.getTime() + 1); // +1 ms to avoid overlap
  }
  return chunks;
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
  const [syncProgress, setSyncProgress] = React.useState<{ connectorId: string; current: number; total: number } | null>(null);
  const [disconnectingId, setDisconnectingId] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<Connector | null>(null);

  // ── Custom date-range sync ─────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split("T")[0];
  const defaultFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
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
      }

      handleCloseModal();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  // ── Per-connector sync (chunked) ──────────────────────────────────────────
  const handleSync = async (connector: Connector, fromDate: Date, toDate: Date) => {
    const endpoints: Partial<Record<Connector["type"], string>> = {
      razorpay: "/api/connectors/razorpay",
      stripe:   "/api/connectors/stripe",
      cashfree: "/api/connectors/cashfree",
      payu:     "/api/connectors/payu",
      paytm:    "/api/connectors/paytm",
      easebuzz: "/api/connectors/easebuzz",
    };
    const endpoint = endpoints[connector.type];

    setSyncingId(connector.id);

    try {
      let totalSynced = 0;
      let totalUpdated = 0;
      const chunkErrors: string[] = [];

      if (endpoint) {
        // ── Chunked parallel sync ─────────────────────────────────────────
        // 30-day client chunks × 10 concurrent = 1 year in 2 batches (~6 s).
        // The server sub-chunks internally into 7-day Razorpay windows, so each
        // Vercel function stays fast (~3 s) regardless of transaction volume.
        //
        // Stripe is the exception: it paginates the FULL window in one function
        // (no server sub-chunking), and high-volume accounts page deeply, so we
        // use smaller windows and lower concurrency to keep every function well
        // under the 60 s budget and well within Stripe's read rate limit.
        const isStripe = connector.type === "stripe";
        const CONCURRENCY = isStripe ? 5 : 10;
        const chunks = splitDateRange(fromDate, toDate, isStripe ? 15 : CHUNK_DAYS);
        setSyncProgress({ connectorId: connector.id, current: 0, total: chunks.length });
        let completed = 0;

        const fetchChunk = async (chunk: { from: Date; to: Date }) => {
          try {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                connector_id: connector.id,
                org_id: orgId,
                from_date: chunk.from.toISOString(),
                to_date:   chunk.to.toISOString(),
                // HMAC token generated server-side at page load; lets the API
                // route skip Supabase cookie auth entirely (saves ~600 ms per call)
                sync_token: syncTokens[connector.id],
              }),
            });
            if (!res.ok) {
              const errBody = await res.json().catch(() => ({})) as { error?: string };
              const errMsg = errBody.error ?? `HTTP ${res.status}`;
              console.error(`[sync] chunk ${chunk.from.toISOString().slice(0,10)}→${chunk.to.toISOString().slice(0,10)} failed: ${errMsg}`);
              return { synced: 0, updated: 0, errors: [errMsg] };
            }
            const data = await res.json() as { synced?: number; updated?: number; warnings?: string[] };
            return {
              synced:  data.synced  ?? 0,
              updated: data.updated ?? 0,
              errors:  data.warnings?.map((w) => `warn: ${w}`) ?? [],
            };
          } catch (e) {
            const errMsg = e instanceof Error ? e.message.slice(0, 120) : "Network error";
            console.error(`[sync] chunk ${chunk.from.toISOString().slice(0,10)}→${chunk.to.toISOString().slice(0,10)} threw: ${errMsg}`);
            return { synced: 0, updated: 0, errors: [errMsg] };
          }
        };

        // Process in batches of CONCURRENCY; update progress after each batch
        for (let i = 0; i < chunks.length; i += CONCURRENCY) {
          const batch = chunks.slice(i, i + CONCURRENCY);
          const results = await Promise.all(batch.map(fetchChunk));
          completed += batch.length;
          setSyncProgress({ connectorId: connector.id, current: Math.min(completed, chunks.length), total: chunks.length });
          for (const r of results) {
            totalSynced  += r.synced;
            totalUpdated += r.updated;
            chunkErrors.push(...r.errors);
          }
        }
      } else {
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
        totalSynced = data.total_inserted ?? 0;
        totalUpdated = data.total_updated ?? 0;
      }

      setActiveConnectors((prev) =>
        prev.map((c) =>
          c.id === connector.id ? { ...c, last_synced_at: new Date().toISOString() } : c
        )
      );

      const hardErrors = chunkErrors.filter((e) => !e.startsWith("warn:"));
      const softWarns  = chunkErrors.filter((e) => e.startsWith("warn:"));
      // Counts must reflect DISTINCT problems, not sub-window fan-out. A single
      // date range is split into many 7-day windows server-side, so one broken
      // endpoint produces one warning per window. Dedupe by reason so "13 windows
      // failed the same way" reads as one issue, not "13 transactions skipped".
      const hardReasons = Array.from(new Set(hardErrors.map((e) => e.trim())));
      if (hardErrors.length > 0 && totalSynced === 0 && totalUpdated === 0) {
        // Nothing got through — show the first real error prominently
        toast.error(`Sync failed: ${hardReasons[0]}`);
      } else if (hardErrors.length > 0) {
        toast.warning(
          `Synced ${totalSynced} new, refreshed ${totalUpdated} · ${hardReasons.length} error${hardReasons.length > 1 ? "s" : ""}: ${hardReasons[0]}`
        );
      } else if (softWarns.length > 0) {
        // Surface the ACTUAL reason (e.g. "Invalid API Key…") instead of
        // "see console". Warnings look like "warn: charges: <error>" — strip
        // the prefix and dedupe so repeated identical errors show once.
        const reasons = Array.from(
          new Set(softWarns.map((w) => w.replace(/^warn:\s*/, "").trim()))
        );
        const reason = reasons[0] + (reasons.length > 1 ? ` (+${reasons.length - 1} more)` : "");
        if (totalSynced === 0 && totalUpdated === 0) {
          // Every call was skipped and nothing imported — this is effectively a failure.
          toast.error(`Couldn't sync — ${reason}`);
        } else {
          toast.warning(
            `Synced ${totalSynced} new, refreshed ${totalUpdated} · ${reasons.length} warning${reasons.length > 1 ? "s" : ""} — ${reason}`
          );
        }
        console.warn("[sync warnings]", softWarns);
      } else {
        toast.success(`Synced ${totalSynced} new, refreshed ${totalUpdated}`);
      }
    } catch (err) {
      toast.error(`Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
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
              const keyId = getKeyIdentifier(inst.type, cfg);
              const contextInfo = [cfg.email, cfg.mid].filter(Boolean).join(" · ");
              const subtitle = [keyId, contextInfo].filter(Boolean).join(" · ")
                || (inst.last_synced_at ? `Synced ${formatDate(inst.last_synced_at)}` : "Never synced");

              const isConfirming = confirmRemove?.id === inst.id;

              return (
                <div
                  key={inst.id}
                  className={cn(
                    "rounded-xl border transition-all",
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
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => handleOpenEdit(inst)} title="Edit credentials"
                          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-all">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <SyncDropdown
                          connector={inst}
                          isSyncing={syncingId === inst.id}
                          progress={syncProgress?.connectorId === inst.id ? syncProgress : null}
                          onSync={(from, to) => handleSync(inst, from, to)}
                          onCustom={() => {
                            setCustomFrom(defaultFrom);
                            setCustomTo(todayStr);
                            setCustomSyncConnector(inst);
                          }}
                        />
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
              {/* Date inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70 block mb-1.5">
                    From
                  </label>
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo || todayStr}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="w-full rounded-lg text-[12.5px] text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors [color-scheme:dark]"
                    style={{
                      background: "hsl(var(--accent))",
                      border: "1px solid hsl(var(--border))",
                      padding: "8px 10px",
                    }}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground/70 block mb-1.5">
                    To
                  </label>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={todayStr}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="w-full rounded-lg text-[12.5px] text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors [color-scheme:dark]"
                    style={{
                      background: "hsl(var(--accent))",
                      border: "1px solid hsl(var(--border))",
                      padding: "8px 10px",
                    }}
                  />
                </div>
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

/**
 * Returns a masked key identifier for a connector so users can visually
 * distinguish which account is which without exposing full credentials.
 * e.g. "rzp_live_ABCDE12345" → "rzp_live_ABCDE…2345"
 */
function maskKey(s: string): string {
  if (s.length <= 16) return s;
  return `${s.slice(0, 13)}…${s.slice(-4)}`;
}

function getKeyIdentifier(type: Connector["type"], cfg: Record<string, string>): string | null {
  switch (type) {
    case "razorpay":
      // key_id is non-secret (rzp_live_xxx / rzp_test_xxx) — safe to show masked
      return cfg.key_id ? maskKey(cfg.key_id) : null;
    case "stripe":
      // Only the prefix reveals mode (live vs test); never show full key
      return cfg.secret_key ? `${cfg.secret_key.slice(0, 11)}…` : null;
    case "zoho":
      return cfg.client_id ? maskKey(cfg.client_id) : null;
    case "quickbooks":
      return cfg.realm_id ? `Realm ${cfg.realm_id}` : null;
    case "tally":
      return cfg.host ? `${cfg.host}:${cfg.port ?? "9000"}` : null;
    case "cashfree":
      return cfg.client_id ? maskKey(cfg.client_id) : null;
    case "payu":
      return cfg.key ? maskKey(cfg.key) : null;
    case "paytm":
      return cfg.merchant_id ? maskKey(cfg.merchant_id) : null;
    case "easebuzz":
      return cfg.key ? maskKey(cfg.key) : null;
    default:
      return null;
  }
}

// ─── Sync dropdown ────────────────────────────────────────────────────────────

interface SyncDropdownProps {
  connector: Connector;
  isSyncing: boolean;
  progress: { connectorId: string; current: number; total: number } | null;
  onSync: (from: Date, to: Date) => void;
  onCustom: () => void;
}

function SyncDropdown({ isSyncing, progress, onSync, onCustom }: SyncDropdownProps) {
  const showProgress = isSyncing && progress && progress.total > 1;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          disabled={isSyncing}
          title={isSyncing ? "Syncing…" : "Sync — choose date range"}
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-all disabled:opacity-60"
        >
          {showProgress ? (
            <span className="text-[9px] font-bold text-primary/70 tabular-nums leading-none min-w-[28px] inline-block text-center">
              {progress!.current}/{progress!.total}
            </span>
          ) : isSyncing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
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
          {/* Header */}
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[9.5px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70">
              Sync date range
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
                {preset.chunks} req{preset.chunks > 1 ? "s" : ""}
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
              Each request covers 30 days.
              <br />Duplicates are skipped automatically.
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
