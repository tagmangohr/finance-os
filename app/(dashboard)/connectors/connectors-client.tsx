"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Upload,
  Link2,
  X,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import type { Connector } from "@/lib/supabase/types";

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
    description: "Auto-sync payments, settlements, refunds",
    icon: "💳",
    fields: [
      { key: "key_id", label: "Key ID", placeholder: "rzp_live_..." },
      { key: "key_secret", label: "Key Secret", type: "password", placeholder: "••••••••••••••••" },
    ],
  },
  {
    type: "stripe",
    name: "Stripe",
    description: "Pull charges, payouts, and invoices",
    icon: "⚡",
    fields: [
      { key: "secret_key", label: "Secret Key", type: "password", placeholder: "sk_live_..." },
    ],
  },
  {
    type: "zoho",
    name: "Zoho Books",
    description: "Import invoices, bills, and journal entries",
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
    description: "Sync P&L, balance sheet, transactions",
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
    description: "Import Tally ERP vouchers and ledgers",
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

interface ConnectorsClientProps {
  orgId: string;
  connectors: Connector[];
}

export function ConnectorsClient({ orgId, connectors }: ConnectorsClientProps) {
  const [activeConnectors, setActiveConnectors] = React.useState<Connector[]>(connectors);
  const [openModal, setOpenModal] = React.useState<ConnectorDef | null>(null);
  const [formValues, setFormValues] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);
  const [syncingId, setSyncingId] = React.useState<string | null>(null);

  // CSV state
  const [csvFile, setCsvFile] = React.useState<File | null>(null);
  const [csvHeaders, setCsvHeaders] = React.useState<string[]>([]);
  const [csvMapping, setCsvMapping] = React.useState<Record<string, string>>({});

  const getConnectorStatus = (type: Connector["type"]) =>
    activeConnectors.find((c) => c.type === type);

  const handleOpenModal = (def: ConnectorDef) => {
    setOpenModal(def);
    setFormValues({});
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

    // Auto-detect common header names
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
      let body: Record<string, unknown> = { type: openModal.type, org_id: orgId };

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

      body = { ...body, config: formValues };
      const res = await fetch("/api/connectors/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      setActiveConnectors((prev) => {
        const existing = prev.find((c) => c.type === openModal.type);
        if (existing) {
          return prev.map((c) => (c.type === openModal.type ? { ...c, status: "active" } : c));
        }
        return [...prev, data.connector];
      });

      toast.success(`${openModal.name} connected successfully`);
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
      const res = await fetch("/api/connectors/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector_id: connector.id }),
      });
      if (!res.ok) throw new Error(await res.text());
      setActiveConnectors((prev) =>
        prev.map((c) =>
          c.id === connector.id
            ? { ...c, last_synced_at: new Date().toISOString() }
            : c
        )
      );
      toast.success("Sync complete");
    } catch {
      toast.error("Sync failed. Please try again.");
    } finally {
      setSyncingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Connectors</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Connect your payment gateways and accounting software
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CONNECTOR_DEFS.map((def) => {
          const existing = getConnectorStatus(def.type);
          const isConnected = existing?.status === "active";
          const isError = existing?.status === "error";

          return (
            <Card
              key={def.type}
              className={cn(
                "relative transition-shadow hover:shadow-md",
                isConnected && "ring-1 ring-green-500/30"
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{def.icon}</span>
                    <div>
                      <CardTitle className="text-sm">{def.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                    </div>
                  </div>
                  {isConnected ? (
                    <Badge variant="success" className="flex-shrink-0">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  ) : isError ? (
                    <Badge variant="destructive" className="flex-shrink-0">
                      <XCircle className="h-3 w-3 mr-1" />
                      Error
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="flex-shrink-0">
                      Not connected
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {existing?.last_synced_at && (
                  <p className="text-xs text-muted-foreground mb-3">
                    Last synced: {formatDate(existing.last_synced_at)}
                  </p>
                )}
                <div className="flex gap-2">
                  {isConnected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 flex-1"
                      onClick={() => handleSync(existing)}
                      disabled={syncingId === existing.id}
                    >
                      <RefreshCw
                        className={cn(
                          "h-3.5 w-3.5",
                          syncingId === existing.id && "animate-spin"
                        )}
                      />
                      {syncingId === existing.id ? "Syncing…" : "Sync Now"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      className="gap-1.5 flex-1"
                      onClick={() => handleOpenModal(def)}
                    >
                      {def.isCSV ? (
                        <>
                          <Upload className="h-3.5 w-3.5" />
                          Upload
                        </>
                      ) : (
                        <>
                          <Link2 className="h-3.5 w-3.5" />
                          Connect
                        </>
                      )}
                    </Button>
                  )}
                  {(isConnected || isError) && !def.isCSV && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleOpenModal(def)}
                      title="Reconfigure"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Connect / CSV Modal */}
      <Dialog.Root open={!!openModal} onOpenChange={(open) => !open && setOpenModal(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-card border border-border rounded-xl shadow-xl p-6 focus:outline-none">
            <div className="flex items-center justify-between mb-5">
              <Dialog.Title className="text-base font-semibold text-foreground">
                {openModal?.isCSV ? `Upload ${openModal.name}` : `Connect ${openModal?.name}`}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 hover:bg-muted">
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
                <p className="text-sm text-muted-foreground">
                  Enter your {openModal?.name} API credentials. They are encrypted and stored securely.
                </p>
                {openModal?.fields?.map((field) => (
                  <div key={field.key}>
                    <label className="text-sm font-medium text-foreground block mb-1.5">
                      {field.label}
                    </label>
                    <Input
                      type={field.type ?? "text"}
                      placeholder={field.placeholder}
                      value={formValues[field.key] ?? ""}
                      onChange={(e) =>
                        setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <Dialog.Close asChild>
                <Button variant="outline" className="flex-1">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                className="flex-1"
                onClick={handleConnect}
                disabled={loading}
              >
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
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
          csvFile
            ? "border-green-500 bg-green-50 dark:bg-green-900/10"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        )}
      >
        {csvFile ? (
          <div className="flex flex-col items-center gap-1">
            <CheckCircle2 className="h-6 w-6 text-green-600 mb-1" />
            <p className="text-sm font-medium text-foreground">{csvFile.name}</p>
            <p className="text-xs text-muted-foreground">
              {(csvFile.size / 1024).toFixed(1)} KB · Click to change
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <Upload className="h-6 w-6 text-muted-foreground mb-1" />
            <p className="text-sm font-medium text-foreground">Click to upload CSV</p>
            <p className="text-xs text-muted-foreground">CSV, XLS, XLSX accepted</p>
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
          <p className="text-sm font-medium text-foreground mb-2">Column Mapping</p>
          <p className="text-xs text-muted-foreground mb-3">
            Auto-detected {Object.values(csvMapping).filter(Boolean).length} of {csvHeaders.length} columns.
            Adjust as needed.
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {csvHeaders.map((header) => (
              <div key={header} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-28 truncate flex-shrink-0 font-mono bg-muted px-1.5 py-0.5 rounded">
                  {header}
                </span>
                <span className="text-xs text-muted-foreground">→</span>
                <select
                  value={csvMapping[header] ?? ""}
                  onChange={(e) =>
                    onMappingChange({ ...csvMapping, [header]: e.target.value })
                  }
                  className="flex-1 text-xs rounded border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {CSV_COLUMN_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
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
