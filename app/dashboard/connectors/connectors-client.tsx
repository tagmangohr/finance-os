"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  RefreshCw,
  Upload,
  X,
  AlertCircle,
  Zap,
  Trash2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDate } from "@/lib/utils";
import type { Connector } from "@/lib/supabase/types";

// ─── Connector definitions ────────────────────────────────────────────────────

interface ConnectorDef {
  type: Connector["type"];
  name: string;
  description: string;
  icon: string;
  fields?: { key: string; label: string; type?: string; placeholder?: string }[];
  isCSV?: boolean;
}

const CONNECTOR_DEFS: ConnectorDef[] = [
  {
    type: "razorpay",
    name: "Razorpay",
    description: "Payments, refunds, settlements, disputes",
    icon: "💳",
    fields: [
      { key: "key_id", label: "Key ID", placeholder: "rzp_live_..." },
      { key: "key_secret", label: "Key Secret", type: "password", placeholder: "••••••••••••••••" },
    ],
  },
  {
    type: "stripe",
    name: "Stripe",
    description: "Charges, payouts, and invoices",
    icon: "⚡",
    fields: [
      { key: "secret_key", label: "Secret Key", type: "password", placeholder: "sk_live_..." },
    ],
  },
  {
    type: "zoho",
    name: "Zoho Books",
    description: "Invoices, bills, and journal entries",
    icon: "📚",
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "1000.XXXX..." },
      { key: "client_secret", label: "Client Secret", type: "password", placeholder: "••••••••" },
      { key: "org_id", label: "Organisation ID", placeholder: "20XXXXXXXX" },
    ],
  },
  {
    type: "quickbooks",
    name: "QuickBooks",
    description: "P&L, balance sheet, transactions",
    icon: "🟢",
    fields: [
      { key: "client_id", label: "Client ID", placeholder: "ABc1234..." },
      { key: "client_secret", label: "Client Secret", type: "password", placeholder: "••••••••" },
      { key: "realm_id", label: "Realm ID", placeholder: "1234567890" },
    ],
  },
  {
    type: "tally",
    name: "Tally",
    description: "Tally ERP vouchers and ledgers",
    icon: "🧾",
    fields: [
      { key: "host", label: "Tally Host", placeholder: "localhost" },
      { key: "port", label: "Port", placeholder: "9000" },
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

// ─── Main component ───────────────────────────────────────────────────────────

export function ConnectorsClient({ orgId, connectors }: ConnectorsClientProps) {
  const [activeConnectors, setActiveConnectors] = React.useState<Connector[]>(connectors);
  const [openModal, setOpenModal] = React.useState<ConnectorDef | null>(null);
  // formValues holds both the "name" key and any API credential keys
  const [formValues, setFormValues] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [syncingId, setSyncingId] = React.useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = React.useState<string | null>(null);

  const [csvFile, setCsvFile] = React.useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = React.useState<string[]>([]);
  const [csvMapping, setCsvMapping] = React.useState<Record<string, string>>({});

  // All connected instances of a given type
  const getConnectorsOfType = (type: Connector["type"]) =>
    activeConnectors.filter((c) => c.type === type);

  const handleOpenModal = (def: ConnectorDef) => {
    setOpenModal(def);
    // Pre-fill name so the user can just change the number/label
    const existingCount = getConnectorsOfType(def.type).length;
    setFormValues({
      name: existingCount === 0 ? def.name : `${def.name} ${existingCount + 1}`,
    });
    setCsvFile(null);
    setCsvHeaders([]);
    setCsvMapping({});
  };

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

  const handleConnect = async () => {
    if (!openModal) return;
    setLoading(true);

    try {
      if (openModal.isCSV) {
        if (!csvFile) {
          toast.error("Please upload a file first");
          setLoading(false);
          return;
        }
        const formData = new FormData();
        formData.append("file", csvFile);
        formData.append("type", openModal.type);
        formData.append("org_id", orgId);
        formData.append("mapping", JSON.stringify(csvMapping));

        const res = await fetch("/api/connectors/csv", { method: "POST", body: formData });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        toast.success(`Imported ${data.imported ?? 0} transactions`);
        setOpenModal(null);
        setLoading(false);
        return;
      }

      // Extract name from formValues, pass the rest as config
      const { name: connectorName, ...credFields } = formValues;
      const body = {
        org_id: orgId,
        type: openModal.type,
        name: connectorName?.trim() || openModal.name,
        config: credFields,
        status: "active",
      };

      const res = await fetch("/api/connectors/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const connector = await res.json();

      // Always append — never replace — so multiple accounts work
      setActiveConnectors((prev) => [...prev, connector]);

      toast.success(`${connectorName || openModal.name} connected`);
      setOpenModal(null);
    } catch (err) {
      toast.error(`Failed to connect: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (connector: Connector) => {
    setSyncingId(connector.id);
    try {
      const syncEndpoints: Partial<Record<Connector["type"], string>> = {
        razorpay: "/api/connectors/razorpay",
        stripe: "/api/connectors/stripe",
      };
      const endpoint = syncEndpoints[connector.type];

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

  const handleDisconnect = async (connectorId: string) => {
    setDisconnectingId(connectorId);
    try {
      const res = await fetch(`/api/connectors/manage?id=${connectorId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      setActiveConnectors((prev) => prev.filter((c) => c.id !== connectorId));
      toast.success("Connector removed");
    } catch (err) {
      toast.error(`Failed to disconnect: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDisconnectingId(null);
    }
  };

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
                "relative rounded-2xl border bg-card p-5 transition-all duration-200 hover:border-white/[0.1] hover:-translate-y-0.5 shadow-[0_1px_3px_rgba(0,0,0,0.4)] flex flex-col gap-4",
                hasActive
                  ? "border-emerald-500/20 shadow-[0_0_20px_hsl(158_64%_48%/0.08)]"
                  : "border-border/60"
              )}
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              {/* Header row */}
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

              {/* Connected instances list */}
              {instances.length > 0 && (
                <div className="space-y-1.5">
                  {instances.map((inst) => (
                    <div
                      key={inst.id}
                      className={cn(
                        "flex items-center gap-2 rounded-xl px-3 py-2 border",
                        inst.status === "error"
                          ? "border-red-500/20 bg-red-500/[0.04]"
                          : "border-white/[0.06] bg-white/[0.025]"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white/70 truncate">{inst.name}</p>
                        {inst.last_synced_at ? (
                          <p className="text-[10px] text-white/25">
                            Synced {formatDate(inst.last_synced_at)}
                          </p>
                        ) : (
                          <p className="text-[10px] text-white/20">Never synced</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {inst.status === "error" && (
                          <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                        )}
                        <button
                          onClick={() => handleSync(inst)}
                          disabled={syncingId === inst.id}
                          title="Sync now"
                          className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all disabled:opacity-40"
                        >
                          <RefreshCw
                            className={cn("h-3.5 w-3.5", syncingId === inst.id && "animate-spin")}
                          />
                        </button>
                        <button
                          onClick={() => handleDisconnect(inst.id)}
                          disabled={disconnectingId === inst.id}
                          title="Remove"
                          className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/[0.08] transition-all disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
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
                  onClick={() => handleOpenModal(def)}
                >
                  {instances.length > 0 ? (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      Add Account
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5" />
                      Connect
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="gap-1.5 w-full transition-all"
                  onClick={() => handleOpenModal(def)}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload File
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {/* Connect / Upload Modal */}
      <Dialog.Root open={!!openModal} onOpenChange={(open) => !open && setOpenModal(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md animate-fade-in" />
          <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#0c1221] border border-white/[0.08] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.7)] p-6 focus:outline-none animate-scale-in">
            <div className="flex items-center justify-between mb-5">
              <Dialog.Title className="text-base font-semibold text-white/85">
                {openModal?.isCSV ? `Upload ${openModal.name}` : `Connect ${openModal?.name}`}
              </Dialog.Title>
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
              <div className="space-y-4">
                <p className="text-sm text-white/35 leading-relaxed">
                  Enter your {openModal?.name} API credentials. Stored encrypted, never logged.
                </p>

                {/* Account name field */}
                <div>
                  <label className="text-xs font-medium text-white/45 block mb-1.5 uppercase tracking-wide">
                    Account Label
                  </label>
                  <Input
                    type="text"
                    placeholder={`e.g. ${openModal?.name} Production`}
                    value={formValues.name ?? ""}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, name: e.target.value }))
                    }
                    className="border-white/[0.08] bg-white/[0.03] text-white/80 placeholder:text-white/20 focus:border-primary/30 focus:ring-primary/20"
                  />
                </div>

                {/* Credential fields */}
                {openModal?.fields?.map((field) => (
                  <div key={field.key}>
                    <label className="text-xs font-medium text-white/45 block mb-1.5 uppercase tracking-wide">
                      {field.label}
                    </label>
                    <Input
                      type={field.type ?? "text"}
                      placeholder={field.placeholder}
                      value={formValues[field.key] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      className="border-white/[0.08] bg-white/[0.03] text-white/80 placeholder:text-white/20 focus:border-primary/30 focus:ring-primary/20"
                    />
                  </div>
                ))}
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
              <Button className="flex-1" onClick={handleConnect} disabled={loading}>
                {loading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    {openModal?.isCSV ? "Importing…" : "Connecting…"}
                  </>
                ) : openModal?.isCSV ? (
                  "Import"
                ) : (
                  "Connect"
                )}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
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

function CSVUploadForm({
  csvFile,
  csvHeaders,
  csvMapping,
  onFileChange,
  onMappingChange,
}: CSVUploadFormProps) {
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
            <p className="text-xs text-white/30">
              {(csvFile.size / 1024).toFixed(1)} KB · Click to change
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload className="h-6 w-6 text-white/25 mb-1" />
            <p className="text-sm font-medium text-white/55">Click to upload CSV</p>
            <p className="text-xs text-white/25">CSV, XLS, XLSX accepted</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileChange(file);
          }}
        />
      </div>

      {csvHeaders.length > 0 && (
        <div>
          <p className="text-xs font-medium text-white/55 mb-1.5 uppercase tracking-wide">Column Mapping</p>
          <p className="text-xs text-white/25 mb-3">
            Auto-detected {Object.values(csvMapping).filter(Boolean).length} of{" "}
            {csvHeaders.length} columns.
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
                  className="flex-1 text-xs rounded-lg border border-white/[0.07] bg-white/[0.03] text-white/60 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/25"
                >
                  {CSV_COLUMN_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value} className="bg-[#0c1221]">
                      {opt.label}
                    </option>
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
