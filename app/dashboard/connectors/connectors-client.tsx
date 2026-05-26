"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  RefreshCw,
  Upload,
  X,
  Zap,
  Trash2,
  Plus,
  Pencil,
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
  icon: string;
  fields?: FieldDef[];
  isCSV?: boolean;
}

const CONNECTOR_DEFS: ConnectorDef[] = [
  {
    type: "razorpay",
    name: "Razorpay",
    description: "Payments, refunds, settlements, disputes",
    icon: "💳",
    fields: [
      { key: "key_id",     label: "Key ID",      placeholder: "rzp_live_..." },
      { key: "key_secret", label: "Key Secret",  isPassword: true, placeholder: "••••••••••••••••" },
      { key: "email",      label: "Account Email", placeholder: "you@company.com", isOptional: true },
      { key: "mid",        label: "Merchant ID (MID)", placeholder: "MID12345", isOptional: true },
    ],
  },
  {
    type: "stripe",
    name: "Stripe",
    description: "Charges, payouts, and invoices",
    icon: "⚡",
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
    icon: "📚",
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
    icon: "🟢",
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
    icon: "🧾",
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
    icon: "🔵",
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
    icon: "🟠",
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
    icon: "🔷",
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
    icon: "🟡",
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
    icon: "🏦",
    isCSV: true,
  },
  {
    type: "csv",
    name: "Generic CSV",
    description: "Upload any CSV with transactions",
    icon: "📄",
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface ConnectorsClientProps {
  orgId: string;
  connectors: Connector[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ConnectorsClient({ orgId, connectors }: ConnectorsClientProps) {
  const [activeConnectors, setActiveConnectors] = React.useState<Connector[]>(connectors);

  // Modal state
  const [openModal, setOpenModal] = React.useState<ConnectorDef | null>(null);
  const [editingConnector, setEditingConnector] = React.useState<Connector | null>(null);

  // formValues persists across modal open/close — cleared only on confirm/cancel
  const [formValues, setFormValues] = React.useState<Record<string, string>>({});

  const [loading, setLoading] = React.useState(false);
  const [syncingId, setSyncingId] = React.useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = React.useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState<Connector | null>(null);

  const [csvFile, setCsvFile] = React.useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = React.useState<string[]>([]);
  const [csvMapping, setCsvMapping] = React.useState<Record<string, string>>({});

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
        if (!res.ok) throw new Error(await res.text());
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
          if (field.isPassword) {
            // Only update if user typed something (non-empty)
            if (val && val.trim()) updatedCfg[field.key] = val.trim();
          } else {
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
        if (!res.ok) throw new Error(await res.text());
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
        if (!res.ok) throw new Error(await res.text());
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

  // ── Per-connector sync ─────────────────────────────────────────────────────
  const handleSync = async (connector: Connector) => {
    setSyncingId(connector.id);
    try {
      const endpoints: Partial<Record<Connector["type"], string>> = {
        razorpay: "/api/connectors/razorpay",
        stripe:   "/api/connectors/stripe",
        cashfree: "/api/connectors/cashfree",
        payu:     "/api/connectors/payu",
        paytm:    "/api/connectors/paytm",
        easebuzz: "/api/connectors/easebuzz",
      };
      const endpoint = endpoints[connector.type];
      let synced = 0;

      if (endpoint) {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connector_id: connector.id, org_id: orgId }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        synced = data.synced ?? 0;
      } else {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ org_id: orgId }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        synced = data.total_inserted ?? 0;
      }

      setActiveConnectors((prev) =>
        prev.map((c) =>
          c.id === connector.id ? { ...c, last_synced_at: new Date().toISOString() } : c
        )
      );
      toast.success(`Synced ${synced} new transactions`);
    } catch (err) {
      toast.error(`Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncingId(null);
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

  return (
    <div className="space-y-5 max-w-[1400px]">
      <div className="animate-enter">
        <h1 className="text-xl font-bold text-white/85">Connectors</h1>
        <p className="text-sm text-white/30 mt-0.5">
          Connect payment gateways and accounting tools — multiple accounts per source supported
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CONNECTOR_DEFS.map((def, i) => {
          const instances = getConnectorsOfType(def.type);
          const hasActive = instances.some((c) => c.status === "active");

          return (
            <div
              key={def.type}
              className={cn(
                "relative rounded-2xl border bg-card p-5 flex flex-col gap-4 transition-all duration-200 hover:border-white/[0.1] shadow-[0_1px_3px_rgba(0,0,0,0.4)]",
                hasActive
                  ? "border-emerald-500/20 shadow-[0_0_20px_hsl(158_64%_48%/0.08)]"
                  : "border-border/60"
              )}
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              {/* Header */}
              <div className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5">{def.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/80">{def.name}</p>
                  <p className="text-xs text-white/30 mt-0.5 leading-relaxed">{def.description}</p>
                </div>
                {hasActive && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_hsl(158_64%_48%/0.8)]" />
                    <span className="text-[10px] text-emerald-400/70 font-medium">Live</span>
                  </div>
                )}
              </div>

              {/* Connected instances */}
              {instances.length > 0 && (
                <div className="space-y-1.5">
                  {instances.map((inst) => {
                    const cfg = (inst.config ?? {}) as Record<string, string>;

                    // Primary key identifier — masked so secrets aren't fully exposed
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
                            : "border-white/[0.06] bg-white/[0.025]"
                        )}
                      >
                        {/* Normal row */}
                        {!isConfirming ? (
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-white/70 truncate">{inst.name}</p>
                              <p className="text-[10px] text-white/25 truncate font-mono">{subtitle}</p>
                            </div>
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              {/* Edit */}
                              <button
                                onClick={() => handleOpenEdit(inst)}
                                title="Edit credentials"
                                className="p-1.5 rounded-lg text-white/20 hover:text-white/60 hover:bg-white/[0.06] transition-all"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {/* Sync */}
                              <button
                                onClick={() => handleSync(inst)}
                                disabled={syncingId === inst.id}
                                title="Sync now"
                                className="p-1.5 rounded-lg text-white/20 hover:text-white/60 hover:bg-white/[0.06] transition-all disabled:opacity-40"
                              >
                                <RefreshCw className={cn("h-3.5 w-3.5", syncingId === inst.id && "animate-spin")} />
                              </button>
                              {/* Remove — show confirmation first */}
                              <button
                                onClick={() => setConfirmRemove(inst)}
                                disabled={disconnectingId === inst.id}
                                title="Remove"
                                className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/[0.08] transition-all disabled:opacity-40"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* Confirmation row */
                          <div className="px-3 py-2.5 space-y-2">
                            <p className="text-[11px] text-red-400/90 leading-snug">
                              Remove <span className="font-semibold">{inst.name}</span> and all its synced transactions?
                            </p>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => setConfirmRemove(null)}
                                className="flex-1 text-[11px] font-medium text-white/40 hover:text-white/70 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.07] rounded-lg py-1 transition-all"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleDisconnect(inst.id)}
                                disabled={disconnectingId === inst.id}
                                className="flex-1 text-[11px] font-medium text-red-400 hover:text-red-300 bg-red-500/[0.1] hover:bg-red-500/[0.18] border border-red-500/20 rounded-lg py-1 transition-all disabled:opacity-50"
                              >
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
                <Button
                  size="sm"
                  variant={instances.length > 0 ? "outline" : "default"}
                  className={cn(
                    "gap-1.5 w-full transition-all",
                    instances.length > 0 &&
                      "border-white/[0.07] bg-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.04] hover:border-white/[0.12]"
                  )}
                  onClick={() => handleOpenNew(def)}
                >
                  {instances.length > 0
                    ? <><Plus className="h-3.5 w-3.5" /> Add Account</>
                    : <><Zap className="h-3.5 w-3.5" /> Connect</>
                  }
                </Button>
              ) : (
                <Button size="sm" className="gap-1.5 w-full" onClick={() => handleOpenNew(def)}>
                  <Upload className="h-3.5 w-3.5" /> Upload File
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      <Dialog.Root open={!!openModal} onOpenChange={(open) => !open && handleCloseModal()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md animate-fade-in" />
          <Dialog.Content className="fixed z-[201] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#0c1221] border border-white/[0.08] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.7)] p-6 focus:outline-none animate-scale-in">

            <div className="flex items-center justify-between mb-5">
              <div>
                <Dialog.Title className="text-base font-semibold text-white/85">
                  {editingConnector
                    ? `Edit ${openModal?.name}`
                    : openModal?.isCSV
                    ? `Upload ${openModal?.name}`
                    : `Connect ${openModal?.name}`}
                </Dialog.Title>
                {editingConnector && (
                  <p className="text-xs text-white/30 mt-0.5">
                    Leave password fields blank to keep existing credentials
                  </p>
                )}
              </div>
              <Dialog.Close asChild>
                <button className="text-white/25 hover:text-white/60 transition-colors rounded-lg p-1.5 hover:bg-white/[0.06]">
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

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

                {/* Divider */}
                <div className="flex items-center gap-2 py-1">
                  <div className="flex-1 h-px bg-white/[0.05]" />
                  <span className="text-[10px] text-white/20 uppercase tracking-widest">Credentials</span>
                  <div className="flex-1 h-px bg-white/[0.05]" />
                </div>

                {/* API credential fields */}
                {openModal?.fields?.filter((f) => !f.isOptional).map((field) => (
                  <FormField
                    key={field.key}
                    label={field.label}
                    type={field.isPassword ? "password" : "text"}
                    placeholder={
                      editingConnector && field.isPassword
                        ? "Leave blank to keep existing"
                        : field.placeholder
                    }
                    value={formValues[field.key] ?? ""}
                    onChange={(v) => setFormValues((p) => ({ ...p, [field.key]: v }))}
                  />
                ))}

                {/* Optional context fields */}
                {openModal?.fields?.some((f) => f.isOptional) && (
                  <>
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 h-px bg-white/[0.05]" />
                      <span className="text-[10px] text-white/20 uppercase tracking-widest">
                        Optional info
                      </span>
                      <div className="flex-1 h-px bg-white/[0.05]" />
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

            <div className="flex gap-2.5 mt-6">
              <Dialog.Close asChild>
                <Button
                  variant="outline"
                  className="flex-1 border-white/[0.07] bg-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.04] hover:border-white/[0.12]"
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
      <label className="text-xs font-medium text-white/45 block mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      <Input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-white/[0.08] bg-white/[0.03] text-white/80 placeholder:text-white/20 focus:border-primary/30 focus:ring-primary/20"
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
            : "border-white/[0.07] hover:border-primary/30 hover:bg-primary/[0.03]"
        )}
      >
        {csvFile ? (
          <div className="flex flex-col items-center gap-1.5">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 mb-1" />
            <p className="text-sm font-medium text-white/75">{csvFile.name}</p>
            <p className="text-xs text-white/30">{(csvFile.size / 1024).toFixed(1)} KB · Click to change</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload className="h-6 w-6 text-white/25 mb-1" />
            <p className="text-sm font-medium text-white/55">Click to upload CSV</p>
            <p className="text-xs text-white/25">CSV, XLS, XLSX accepted</p>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".csv,.xls,.xlsx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileChange(f); }} />
      </div>

      {csvHeaders.length > 0 && (
        <div>
          <p className="text-xs font-medium text-white/55 mb-1.5 uppercase tracking-wide">Column Mapping</p>
          <p className="text-xs text-white/25 mb-3">
            Auto-detected {Object.values(csvMapping).filter(Boolean).length} of {csvHeaders.length} columns.
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {csvHeaders.map((header) => (
              <div key={header} className="flex items-center gap-2">
                <span className="text-xs text-white/30 w-28 truncate flex-shrink-0 font-mono bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 rounded-md">
                  {header}
                </span>
                <span className="text-xs text-white/20">→</span>
                <select
                  value={csvMapping[header] ?? ""}
                  onChange={(e) => onMappingChange({ ...csvMapping, [header]: e.target.value })}
                  className="flex-1 text-xs rounded-lg border border-white/[0.07] bg-white/[0.03] text-white/60 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  {CSV_COLUMN_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-[#0c1221]">{opt.label}</option>
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
