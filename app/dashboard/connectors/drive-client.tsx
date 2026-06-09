"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  FolderPlus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  HardDrive,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Link,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";
import type { DriveColumnMapping, DriveFolderWithFiles, DriveFile, DriveFolderType } from "@/lib/drive/types";
import { MAPPING_TARGET_OPTIONS as MAPPING_OPTS, EMPTY_MAPPING, FOLDER_TYPE_OPTIONS } from "@/lib/drive/types";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DriveConnectionData {
  id: string;
  provider: "google_drive" | "onedrive";
  account_email: string | null;
  account_name: string | null;
  connector_id: string;
  created_at: string;
  drive_folders: DriveFolderWithFiles[];
}

interface DriveClientProps {
  orgId: string;
  initialConnections: DriveConnectionData[];
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function GoogleDriveIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true">
      <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 000 53h27.5z" fill="#00ac47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.5c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" fill="#ea4335"/>
      <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="M73.4 26.5l-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

function OneDriveIcon({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <linearGradient id="od1" x1="12.5" y1="24.9" x2="35.5" y2="24.9" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#1988D9"/>
        <stop offset=".9" stopColor="#54AFD9"/>
      </linearGradient>
      <path d="M35.5 31H22.3c-2.2 0-4.3-1.6-4.3-4s2.1-4 4.3-4h.7c.4-3.4 3.3-6 6.8-6 3.8 0 6.9 3.1 6.9 6.9 0 .2 0 .4-.1.6.3-.1.6-.1 1-.1 2.2 0 4 1.8 4 4s-1.8 4-4 4c-.3 0-.7 0-1-.1v-.3" fill="url(#od1)"/>
      <linearGradient id="od2" x1="7" y1="29" x2="33" y2="29" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#0049A8"/>
        <stop offset="1" stopColor="#005BB7"/>
      </linearGradient>
      <path d="M26.9 35H11.2C8.3 35 6 32.7 6 29.9c0-2.4 1.7-4.4 4-4.8v-.2c0-5 4.1-9.1 9.1-9.1 3.4 0 6.4 1.9 8 4.7.5-.1 1-.2 1.5-.2 3.5 0 6.4 2.9 6.4 6.4S30.4 33 26.9 33v2" fill="url(#od2)"/>
    </svg>
  );
}

// ─── Mapping review dialog ────────────────────────────────────────────────────

interface MappingDialogProps {
  file: DriveFile;
  onClose: () => void;
  onConfirmed: (updatedFile: DriveFile) => void;
}

function MappingDialog({ file, onClose, onConfirmed }: MappingDialogProps) {
  const [loading, setLoading]       = React.useState(true);
  const [headers, setHeaders]       = React.useState<string[]>([]);
  const [sampleRows, setSampleRows] = React.useState<string[][]>([]);
  const [mapping, setMapping]       = React.useState<DriveColumnMapping>({ ...EMPTY_MAPPING });
  const [saving, setSaving]         = React.useState(false);
  const [error, setError]           = React.useState<string | null>(null);
  // Custom field creation state
  const [creatingCustomFor, setCreatingCustomFor] = React.useState<string | null>(null);
  const [customInput, setCustomInput]             = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/drive/files/${file.id}/preview`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) { setError(data.error); setLoading(false); return; }
        setHeaders(data.headers ?? []);
        setSampleRows(data.sample_rows ?? []);
        setMapping(data.suggested_mapping ?? { ...EMPTY_MAPPING });
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) { setError(e.message); setLoading(false); }
      });

    return () => { cancelled = true; };
  }, [file.id]);

  /** Commit the inline custom-field creation for `col`. */
  const confirmCustomField = React.useCallback((col: string) => {
    const label = customInput.trim();
    if (!label) return;
    setMapping((prev) => {
      const next = { ...prev };
      // Clear any existing standard binding for this column
      (Object.keys(next) as (keyof DriveColumnMapping)[]).forEach((k) => {
        if (k !== "custom_fields" && (next[k] as string | null) === col) {
          (next as unknown as Record<string, string | null>)[k] = null;
        }
      });
      // Clear any existing custom binding for this column
      const cf = { ...(next.custom_fields ?? {}) };
      Object.keys(cf).forEach((lbl) => { if (cf[lbl] === col) delete cf[lbl]; });
      // Add the new custom label → source column binding
      cf[label] = col;
      next.custom_fields = cf;
      return next;
    });
    setCreatingCustomFor(null);
    setCustomInput("");
  }, [customInput]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/drive/files/${file.id}/mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast.success("Column mapping saved");
      onConfirmed(data as DriveFile);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save mapping");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md animate-fade-in" />
        <Dialog.Content
          className="fixed z-[201] w-[calc(100vw-32px)] max-w-[640px] bg-[#0c1221] border border-white/[0.08] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.75)] focus:outline-none animate-scale-in flex flex-col"
          style={{ top: 0, left: 0, right: 0, bottom: 0, margin: "auto", maxHeight: "calc(100vh - 32px)" }}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-4 flex-shrink-0 border-b border-white/[0.05]">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 text-violet-400 mt-0.5 flex-shrink-0" />
              <div>
                <Dialog.Title className="text-[14px] font-semibold text-white/85 leading-snug">
                  Map Columns — {file.file_name}
                </Dialog.Title>
                <p className="text-[11px] text-white/30 mt-0.5">
                  AI has suggested a mapping. Review and adjust before syncing.
                </p>
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="text-white/25 hover:text-white/60 transition-colors rounded-lg p-1.5 hover:bg-white/[0.06] flex-shrink-0">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* Body */}
          <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
            {loading && (
              <div className="flex items-center gap-2 py-6 justify-center">
                <RefreshCw className="h-4 w-4 animate-spin text-white/30" />
                <span className="text-sm text-white/30">Analysing columns with AI…</span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 bg-red-500/[0.08] border border-red-500/20">
                <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-[12.5px] text-red-400/90">{error}</p>
              </div>
            )}

            {!loading && !error && (
              <>
                {/* Sample data preview */}
                {sampleRows.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/30 mb-2">
                      Sample Data Preview
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-white/[0.02]">
                      <table className="w-full text-[11px] font-mono">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            {headers.map((h) => (
                              <th key={h} className="px-2.5 py-2 text-left text-white/40 font-medium whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sampleRows.slice(0, 3).map((row, i) => (
                            <tr key={i} className="border-b border-white/[0.03] last:border-0">
                              {row.map((cell, j) => (
                                <td key={j} className="px-2.5 py-1.5 text-white/50 whitespace-nowrap max-w-[120px] truncate">
                                  {cell || <span className="text-white/15">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Column mapping */}
                <div>
                  <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/30 mb-2">
                    Column Mapping
                  </p>
                  <p className="text-[11px] text-white/25 mb-3">
                    Map each column to its financial meaning. AI suggestions are pre-filled — adjust any that look wrong.
                  </p>

                  <div className="space-y-2">
                    {headers.map((col) => {
                      // Find what this column is currently mapped to (standard or custom)
                      const stdKey = (Object.keys(mapping) as (keyof DriveColumnMapping)[])
                        .find((k) => k !== "custom_fields" && (mapping[k] as string | null) === col) ?? "";
                      const customEntry = Object.entries(mapping.custom_fields ?? {})
                        .find(([, src]) => src === col);
                      const mappedTo = stdKey || (customEntry ? `custom:${customEntry[0]}` : "");

                      // Build the options list: standard + any already-created custom labels + create
                      const existingCustoms = Object.keys(mapping.custom_fields ?? {});

                      return (
                        <div key={col} className="flex items-center gap-2">
                          <span className="text-[11px] text-white/40 font-mono bg-white/[0.04] border border-white/[0.06] px-2 py-1 rounded-lg flex-shrink-0 w-40 truncate">
                            {col}
                          </span>
                          <span className="text-[11px] text-white/20 flex-shrink-0">→</span>

                          {/* ── Inline creation mode ── */}
                          {creatingCustomFor === col ? (
                            <div className="flex-1 flex items-center gap-1.5">
                              <input
                                autoFocus
                                type="text"
                                value={customInput}
                                onChange={(e) => setCustomInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && customInput.trim()) confirmCustomField(col);
                                  if (e.key === "Escape") { setCreatingCustomFor(null); setCustomInput(""); }
                                }}
                                placeholder="e.g. GST Number, Order ID, Tier…"
                                className="flex-1 text-[12px] rounded-lg border border-violet-500/30 bg-violet-500/[0.05] text-white/75 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500/40 placeholder:text-white/20"
                              />
                              <button
                                onClick={() => customInput.trim() && confirmCustomField(col)}
                                disabled={!customInput.trim()}
                                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => { setCreatingCustomFor(null); setCustomInput(""); }}
                                className="p-1.5 rounded-lg text-white/25 hover:text-white/50 transition-colors"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            /* ── Normal dropdown ── */
                            <select
                              value={mappedTo}
                              onChange={(e) => {
                                const target = e.target.value;
                                // Trigger inline creation for the __create__ sentinel
                                if (target === "__create__") {
                                  setCreatingCustomFor(col);
                                  setCustomInput("");
                                  return;
                                }
                                setMapping((prev) => {
                                  const next = { ...prev };
                                  // Clear any existing standard binding for this column
                                  (Object.keys(next) as (keyof DriveColumnMapping)[]).forEach((k) => {
                                    if (k !== "custom_fields" && (next[k] as string | null) === col) {
                                      (next as unknown as Record<string, string | null>)[k] = null;
                                    }
                                  });
                                  // Clear any existing custom binding for this column
                                  const cf = { ...(next.custom_fields ?? {}) };
                                  Object.keys(cf).forEach((lbl) => { if (cf[lbl] === col) delete cf[lbl]; });
                                  // Apply new binding
                                  if (!target) {
                                    // Unmap — nothing more to do
                                  } else if (target.startsWith("custom:")) {
                                    // Re-assign an already-created custom label to a different column
                                    cf[target.slice(7)] = col;
                                  } else {
                                    (next as unknown as Record<string, string | null>)[target] = col;
                                  }
                                  next.custom_fields = Object.keys(cf).length > 0 ? cf : undefined;
                                  return next;
                                });
                              }}
                              className="flex-1 text-[12px] rounded-lg border border-white/[0.07] bg-white/[0.03] text-white/65 px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                            >
                              {MAPPING_OPTS.map((opt) => (
                                <option key={opt.value} value={opt.value} className="bg-[#0c1221]">
                                  {opt.label}
                                </option>
                              ))}
                              {existingCustoms.length > 0 && (
                                <optgroup label="Custom Fields">
                                  {existingCustoms.map((label) => (
                                    <option key={`custom:${label}`} value={`custom:${label}`} className="bg-[#0c1221]">
                                      {label}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              <option value="__create__" className="bg-[#0c1221]">
                                + Create custom field…
                              </option>
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Validation summary */}
                <MappingSummary mapping={mapping} />
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex gap-2.5 px-5 pb-5 pt-4 border-t border-white/[0.05] flex-shrink-0">
            <Dialog.Close asChild>
              <Button variant="outline" className="flex-1 border-white/[0.07] bg-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.04] hover:border-white/[0.12]">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              className="flex-1"
              disabled={saving || loading || !!error || !isMappingValid(mapping)}
              onClick={handleSave}
            >
              {saving ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
              ) : "Confirm Mapping"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MappingSummary({ mapping }: { mapping: DriveColumnMapping }) {
  const hasDate    = !!mapping.date;
  const hasAmount  = !!(mapping.amount || mapping.debit || mapping.credit);
  const hasSplit   = mapping.debit && mapping.credit && !mapping.amount;
  const hasSingle  = !!mapping.amount;
  const customFields = Object.entries(mapping.custom_fields ?? {});

  return (
    <div
      className="rounded-xl px-3.5 py-3 space-y-1.5"
      style={{ background: "rgba(124,82,240,0.06)", border: "1px solid rgba(124,82,240,0.10)" }}
    >
      <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/25 mb-1">Mapping Summary</p>
      <MappingCheck label="Date column"   ok={hasDate}   detail={mapping.date ?? "not set"} />
      {hasSplit
        ? <>
            <MappingCheck label="Debit column"  ok={!!mapping.debit}  detail={mapping.debit  ?? "not set"} />
            <MappingCheck label="Credit column" ok={!!mapping.credit} detail={mapping.credit ?? "not set"} />
          </>
        : <MappingCheck label="Amount column" ok={hasAmount} detail={hasSingle ? mapping.amount! : "not set"} />
      }

      {/* Custom fields — informational, not required for validity */}
      {customFields.length > 0 && (
        <div className="mt-1 pt-2 border-t border-white/[0.05]">
          <p className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/20 mb-1.5">
            Custom Fields ({customFields.length})
          </p>
          {customFields.map(([label, col]) => (
            <div key={label} className="flex items-center gap-2 py-0.5">
              <div className="h-1.5 w-1.5 rounded-full bg-violet-400/40 flex-shrink-0" />
              <span className="text-[11.5px] text-white/45">{label}</span>
              <span className="text-[11px] text-white/25 font-mono ml-auto truncate max-w-[140px]">{col}</span>
            </div>
          ))}
          <p className="text-[10.5px] text-white/20 mt-1">Stored in transaction metadata — queryable but not required.</p>
        </div>
      )}

      {!hasDate && (
        <p className="text-[11px] text-amber-400/80 mt-1">⚠ You must map a Date column before syncing.</p>
      )}
      {!hasAmount && (
        <p className="text-[11px] text-amber-400/80">⚠ Map at least one amount column (Amount, Debit, or Credit).</p>
      )}
    </div>
  );
}

function MappingCheck({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok
        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
        : <AlertCircle  className="h-3.5 w-3.5 text-amber-400/60 flex-shrink-0" />
      }
      <span className="text-[11.5px] text-white/50">{label}</span>
      <span className="text-[11px] text-white/25 font-mono ml-auto">{detail}</span>
    </div>
  );
}

function isMappingValid(m: DriveColumnMapping): boolean {
  return !!m.date && !!(m.amount || m.debit || m.credit);
}

// ─── Add folder dialog ────────────────────────────────────────────────────────

interface AddFolderDialogProps {
  connectionId: string;
  provider: "google_drive" | "onedrive";
  onClose: () => void;
  onAdded: (folder: DriveFolderWithFiles) => void;
}

function AddFolderDialog({ connectionId, provider, onClose, onAdded }: AddFolderDialogProps) {
  const [url, setUrl]             = React.useState("");
  const [folderType, setFolderType] = React.useState<DriveFolderType>("general");
  const [loading, setLoading]     = React.useState(false);
  const [error, setError]         = React.useState<string | null>(null);

  const placeholder =
    provider === "google_drive"
      ? "https://drive.google.com/drive/folders/..."
      : "/Documents/Finance  or  OneDrive folder path";

  const handleAdd = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/drive/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connectionId, folder_url: url.trim(), folder_type: folderType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add folder");
      toast.success(`Folder added — ${data.drive_files?.length ?? 0} file(s) found`);
      onAdded(data as DriveFolderWithFiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add folder");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-md animate-fade-in" />
        <Dialog.Content
          className="fixed z-[201] w-[calc(100vw-32px)] max-w-[460px] bg-[#0c1221] border border-white/[0.08] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.75)] focus:outline-none animate-scale-in flex flex-col"
          style={{ top: 0, left: 0, right: 0, bottom: 0, margin: "auto", maxHeight: "calc(100vh - 32px)" }}
        >
          <div className="flex items-start justify-between px-5 pt-5 pb-4 flex-shrink-0 border-b border-white/[0.05]">
            <div>
              <Dialog.Title className="text-[14px] font-semibold text-white/85">
                Add {provider === "google_drive" ? "Google Drive" : "OneDrive"} Folder
              </Dialog.Title>
              <p className="text-[11px] text-white/30 mt-0.5">
                CSV / Excel files in this folder and its subfolders will be discovered.
              </p>
            </div>
            <Dialog.Close asChild>
              <button className="text-white/25 hover:text-white/60 transition-colors rounded-lg p-1.5 hover:bg-white/[0.06]">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 space-y-3 flex-1">
            <div>
              <label className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/35 block mb-1.5">
                {provider === "google_drive" ? "Folder URL" : "Folder Path or URL"}
              </label>
              <div className="relative">
                <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/20" />
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) handleAdd(); }}
                  placeholder={placeholder}
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-[13px] text-white/75 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-violet-500/30 transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                />
              </div>
            </div>

            {/* Folder type selector */}
            <div>
              <label className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/35 block mb-1.5">
                Folder Type
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {FOLDER_TYPE_OPTIONS.map((opt) => {
                  const active = folderType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFolderType(opt.value)}
                      className="flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all"
                      style={{
                        background: active ? `${opt.color}14` : "rgba(255,255,255,0.025)",
                        border: `1px solid ${active ? `${opt.color}45` : "rgba(255,255,255,0.06)"}`,
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div
                          className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                          style={{ background: opt.color, opacity: active ? 1 : 0.45 }}
                        />
                        <span
                          className="text-[11.5px] font-semibold leading-none"
                          style={{ color: active ? opt.color : "rgba(255,255,255,0.50)" }}
                        >
                          {opt.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/25 leading-snug pl-3">{opt.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {provider === "onedrive" && (
              <div
                className="rounded-xl px-3 py-2.5 text-[11.5px] text-white/35"
                style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                <span className="text-white/50 font-medium">Tip:</span> Enter a folder path like{" "}
                <code className="text-violet-400/70 font-mono text-[11px]">/Documents/Finance</code>{" "}
                or paste a OneDrive share link.
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 bg-red-500/[0.08] border border-red-500/20">
                <AlertCircle className="h-3.5 w-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11.5px] text-red-400/90">{error}</p>
              </div>
            )}
          </div>

          <div className="flex gap-2.5 px-5 pb-5 pt-4 border-t border-white/[0.05] flex-shrink-0">
            <Dialog.Close asChild>
              <Button variant="outline" className="flex-1 border-white/[0.07] bg-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.04] hover:border-white/[0.12]">
                Cancel
              </Button>
            </Dialog.Close>
            <Button className="flex-1" disabled={!url.trim() || loading} onClick={handleAdd}>
              {loading ? (
                <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Scanning folder…</>
              ) : "Add Folder"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Single drive file row ────────────────────────────────────────────────────

interface DriveFileRowProps {
  file: DriveFile;
  onFileUpdated: (file: DriveFile) => void;
}

function DriveFileRow({ file, onFileUpdated }: DriveFileRowProps) {
  const [showMapping, setShowMapping] = React.useState(false);
  const [syncing, setSyncing]         = React.useState(false);

  const handleSync = async () => {
    if (!file.mapping_confirmed) {
      setShowMapping(true);
      return;
    }
    setSyncing(true);
    try {
      const res = await fetch("/api/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: file.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      toast.success(`Synced ${data.inserted} new, updated ${data.updated}`);
      onFileUpdated({ ...file, last_sync_at: new Date().toISOString(), row_count: data.fetched });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleResetMapping = async () => {
    try {
      const res = await fetch(`/api/drive/files/${file.id}/mapping`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to reset mapping");
      const updated = await res.json() as DriveFile;
      onFileUpdated(updated);
      toast.success("Mapping reset");
    } catch {
      toast.error("Failed to reset mapping");
    }
  };

  const ext = file.file_name.split(".").pop()?.toUpperCase() ?? "FILE";
  const isCsv = ext === "CSV";

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all",
          file.mapping_confirmed
            ? "border-white/[0.06] bg-white/[0.025]"
            : "border-amber-500/15 bg-amber-500/[0.03]"
        )}
      >
        {/* File type badge */}
        <div
          className={cn(
            "flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded font-mono",
            isCsv
              ? "bg-emerald-500/[0.15] text-emerald-400/70"
              : "bg-blue-500/[0.15] text-blue-400/70"
          )}
        >
          {ext}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-white/70 truncate">{file.file_name}</p>
          <p className="text-[10px] text-white/25 mt-0.5">
            {file.mapping_confirmed
              ? file.last_sync_at
                ? `Synced ${formatDate(file.last_sync_at)} · ${file.row_count?.toLocaleString() ?? "?"} rows`
                : "Mapping confirmed — not yet synced"
              : "Needs column mapping"}
          </p>
        </div>

        {/* Status badge */}
        {file.mapping_confirmed ? (
          <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-emerald-400/60">
            <CheckCircle2 className="h-3 w-3" />
            Mapped
          </span>
        ) : (
          <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-amber-400/60">
            <AlertCircle className="h-3 w-3" />
            Unmapped
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {file.mapping_confirmed && (
            <button
              onClick={handleResetMapping}
              title="Reset mapping"
              className="p-1.5 rounded-lg text-white/15 hover:text-white/50 hover:bg-white/[0.06] transition-all"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            title={file.mapping_confirmed ? "Sync now" : "Map columns then sync"}
            className={cn(
              "p-1.5 rounded-lg transition-all",
              file.mapping_confirmed
                ? "text-white/20 hover:text-white/60 hover:bg-white/[0.06]"
                : "text-violet-400/50 hover:text-violet-400 hover:bg-violet-500/[0.08]"
            )}
          >
            {syncing
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : file.mapping_confirmed
              ? <RefreshCw className="h-3.5 w-3.5" />
              : <Sparkles className="h-3.5 w-3.5" />
            }
          </button>
        </div>
      </div>

      {showMapping && (
        <MappingDialog
          file={file}
          onClose={() => setShowMapping(false)}
          onConfirmed={(updated) => {
            onFileUpdated(updated);
            setShowMapping(false);
            // Trigger sync immediately after mapping
            setSyncing(true);
            fetch("/api/drive/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ file_id: updated.id }),
            })
              .then((r) => r.json())
              .then((data) => {
                if (data.error) throw new Error(data.error);
                toast.success(`Synced ${data.inserted} new, updated ${data.updated}`);
                onFileUpdated({ ...updated, last_sync_at: new Date().toISOString(), row_count: data.fetched });
              })
              .catch((e) => toast.error(e.message))
              .finally(() => setSyncing(false));
          }}
        />
      )}
    </>
  );
}

// ─── Single folder section ────────────────────────────────────────────────────

interface FolderSectionProps {
  folder: DriveFolderWithFiles;
  onFolderUpdated: (folder: DriveFolderWithFiles) => void;
  onFolderRemoved: (folderId: string) => void;
}

function FolderSection({ folder, onFolderUpdated, onFolderRemoved }: FolderSectionProps) {
  const [expanded, setExpanded] = React.useState(true);
  const [removing, setRemoving] = React.useState(false);
  const [rescanning, setRescanning] = React.useState(false);

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch(`/api/drive/folders/${folder.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove folder");
      toast.success("Folder removed");
      onFolderRemoved(folder.id);
    } catch {
      toast.error("Failed to remove folder");
    } finally {
      setRemoving(false);
    }
  };

  const handleRescan = async () => {
    setRescanning(true);
    try {
      const res = await fetch(`/api/drive/folders/${folder.id}/rescan`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Rescan failed");
      const total: number         = data.new_files_found  ?? 0;
      const autoConfirmed: number = data.auto_confirmed   ?? 0;
      const needsMapping          = total - autoConfirmed;
      if (total === 0) {
        toast.success("No new files found");
      } else if (autoConfirmed > 0 && needsMapping === 0) {
        toast.success(`${autoConfirmed} new file${autoConfirmed !== 1 ? "s" : ""} — mapping inherited automatically, will sync next run`);
      } else if (autoConfirmed > 0) {
        toast.success(`${total} new file${total !== 1 ? "s" : ""} — ${autoConfirmed} auto-mapped, ${needsMapping} need${needsMapping === 1 ? "s" : ""} mapping`);
      } else {
        toast.success(`${total} new file${total !== 1 ? "s" : ""} found — review mapping to start syncing`);
      }
      onFolderUpdated(data as DriveFolderWithFiles);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rescan failed");
    } finally {
      setRescanning(false);
    }
  };

  const handleFileUpdated = (updated: DriveFile) => {
    onFolderUpdated({
      ...folder,
      drive_files: folder.drive_files.map((f) => (f.id === updated.id ? updated : f)),
    });
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
      {/* Folder header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
        >
          {expanded
            ? <ChevronDown  className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />
            : <ChevronRight className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />
          }
          <span className="text-[12px] font-medium text-white/65 truncate">{folder.folder_name}</span>
          <span className="text-[10px] text-white/25 ml-1 flex-shrink-0">
            {folder.drive_files.length} file{folder.drive_files.length !== 1 ? "s" : ""}
          </span>
        </button>
        <a
          href={folder.folder_url}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in Drive"
          className="p-1.5 rounded-lg text-white/15 hover:text-white/50 hover:bg-white/[0.06] transition-all flex-shrink-0"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          onClick={handleRescan}
          disabled={rescanning}
          title="Rescan folder for new files"
          className="p-1.5 rounded-lg text-white/15 hover:text-violet-400 hover:bg-violet-500/[0.08] transition-all flex-shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${rescanning ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={handleRemove}
          disabled={removing}
          title="Remove folder"
          className="p-1.5 rounded-lg text-white/15 hover:text-red-400 hover:bg-red-500/[0.08] transition-all flex-shrink-0"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* File list */}
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {folder.drive_files.length === 0 ? (
            <p className="text-[11px] text-white/25 text-center py-2">No CSV or Excel files found</p>
          ) : (
            folder.drive_files.map((file) => (
              <DriveFileRow
                key={file.id}
                file={file}
                onFileUpdated={handleFileUpdated}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Drive connector card ─────────────────────────────────────────────────────

interface DriveCardProps {
  provider: "google_drive" | "onedrive";
  orgId: string;
  connection: DriveConnectionData | null;
  onConnectionRemoved: (provider: "google_drive" | "onedrive") => void;
  onConnectionUpdated: (conn: DriveConnectionData) => void;
}

function DriveCard({ provider, orgId, connection, onConnectionRemoved, onConnectionUpdated }: DriveCardProps) {
  const [connecting, setConnecting]       = React.useState(false);
  const [addingFolder, setAddingFolder]   = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);

  const isGoogle = provider === "google_drive";
  const name     = isGoogle ? "Google Drive" : "OneDrive";
  const desc     = isGoogle
    ? "Sync transactions from CSV/Excel files in Drive folders"
    : "Sync transactions from CSV/Excel files in OneDrive folders";
  const hasActive = !!connection;

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch(`/api/drive/auth/${isGoogle ? "google" : "onedrive"}?org_id=${orgId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to initiate OAuth");
      // Redirect to OAuth provider
      window.location.href = data.authUrl;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to connect");
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connection) return;
    setDisconnecting(true);
    try {
      const res = await fetch(`/api/drive/connections?id=${connection.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to disconnect");
      toast.success(`${name} disconnected`);
      onConnectionRemoved(provider);
      setConfirmDisconnect(false);
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleFolderAdded = (folder: DriveFolderWithFiles) => {
    if (!connection) return;
    setAddingFolder(false);
    onConnectionUpdated({
      ...connection,
      drive_folders: [...connection.drive_folders, folder],
    });
  };

  const handleFolderUpdated = (updated: DriveFolderWithFiles) => {
    if (!connection) return;
    onConnectionUpdated({
      ...connection,
      drive_folders: connection.drive_folders.map((f) => (f.id === updated.id ? updated : f)),
    });
  };

  const handleFolderRemoved = (folderId: string) => {
    if (!connection) return;
    onConnectionUpdated({
      ...connection,
      drive_folders: connection.drive_folders.filter((f) => f.id !== folderId),
    });
  };

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-card p-5 flex flex-col gap-4 transition-all duration-200 hover:border-white/[0.1] shadow-[0_1px_3px_rgba(0,0,0,0.4)]",
        hasActive
          ? "border-emerald-500/20 shadow-[0_0_20px_hsl(158_64%_48%/0.08)]"
          : "border-border/60"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-white/[0.04] border border-white/[0.06]">
          {isGoogle ? <GoogleDriveIcon size={22} /> : <OneDriveIcon size={22} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white/80">{name}</p>
          <p className="text-xs text-white/30 mt-0.5 leading-relaxed">{desc}</p>
        </div>
        {hasActive && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_hsl(158_64%_48%/0.8)]" />
            <span className="text-[10px] text-emerald-400/70 font-medium">Live</span>
          </div>
        )}
      </div>

      {/* Connected state */}
      {connection && (
        <div className="space-y-2">
          {/* Account info row */}
          <div
            className={cn(
              "rounded-xl border transition-all",
              confirmDisconnect ? "border-red-500/30 bg-red-500/[0.06]" : "border-white/[0.06] bg-white/[0.025]"
            )}
          >
            {!confirmDisconnect ? (
              <div className="flex items-center gap-2 px-3 py-2.5">
                <HardDrive className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/70 truncate">
                    {connection.account_name ?? name}
                  </p>
                  <p className="text-[10px] text-white/25 font-mono truncate">
                    {connection.account_email ?? `Connected ${formatDate(connection.created_at)}`}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmDisconnect(true)}
                  title="Disconnect"
                  className="p-1.5 rounded-lg text-white/15 hover:text-red-400 hover:bg-red-500/[0.08] transition-all flex-shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="px-3 py-2.5 space-y-2">
                <p className="text-[11px] text-red-400/90 leading-snug">
                  Disconnect <span className="font-semibold">{name}</span>? All synced transactions will also be removed.
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setConfirmDisconnect(false)}
                    className="flex-1 text-[11px] font-medium text-white/40 hover:text-white/70 bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.07] rounded-lg py-1 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="flex-1 text-[11px] font-medium text-red-400 hover:text-red-300 bg-red-500/[0.1] hover:bg-red-500/[0.18] border border-red-500/20 rounded-lg py-1 transition-all disabled:opacity-50"
                  >
                    {disconnecting ? "Removing…" : "Yes, remove"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Folders */}
          {connection.drive_folders.map((folder) => (
            <FolderSection
              key={folder.id}
              folder={folder}
              onFolderUpdated={handleFolderUpdated}
              onFolderRemoved={handleFolderRemoved}
            />
          ))}

          {/* Add folder button */}
          <button
            onClick={() => setAddingFolder(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-white/35 hover:text-white/65 transition-all border border-dashed border-white/[0.07] hover:border-violet-500/30 hover:bg-violet-500/[0.04]"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Add Folder
          </button>
        </div>
      )}

      {/* Connect button */}
      {!connection && (
        <Button
          size="sm"
          className="gap-1.5 w-full"
          onClick={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Connecting…</>
          ) : (
            <>{isGoogle ? <GoogleDriveIcon size={14} /> : <OneDriveIcon size={14} />}
              Connect {name}
            </>
          )}
        </Button>
      )}

      {/* Add folder dialog */}
      {addingFolder && connection && (
        <AddFolderDialog
          connectionId={connection.id}
          provider={provider}
          onClose={() => setAddingFolder(false)}
          onAdded={handleFolderAdded}
        />
      )}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function DriveConnectors({ orgId, initialConnections }: DriveClientProps) {
  const router     = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = React.useState<DriveConnectionData[]>(initialConnections);

  // Keep local state in sync if the server re-renders with updated initialConnections
  // (e.g. after router.refresh() re-fetches the server component).
  React.useEffect(() => {
    setConnections(initialConnections);
  }, [initialConnections]);

  // Detect OAuth redirect back — fetch fresh connections so the card shows
  // active immediately without depending on router cache state.
  React.useEffect(() => {
    const connected = searchParams.get("drive_connected");
    const error     = searchParams.get("drive_error");

    if (!connected && !error) return;

    // Strip query params immediately so a browser refresh won't re-trigger
    router.replace("/dashboard/connectors");

    if (connected) {
      const name = connected === "google_drive" ? "Google Drive" : "OneDrive";
      // Fetch fresh connection data directly — this bypasses any router cache
      // and guarantees the card shows the real DB state.
      fetch(`/api/drive/connections?org_id=${orgId}`)
        .then((r) => r.json())
        .then((data: DriveConnectionData[]) => {
          setConnections(data);
          toast.success(`${name} connected successfully`);
        })
        .catch(() => {
          // Fallback: force a full server component re-fetch
          router.refresh();
          toast.success(`${name} connected — refreshing…`);
        });
    } else if (error) {
      toast.error(`Drive connection failed: ${decodeURIComponent(error)}`, {
        duration: 8000,
        description: "Check your Google Cloud Console redirect URIs and env vars.",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getConn = (provider: "google_drive" | "onedrive") =>
    connections.find((c) => c.provider === provider) ?? null;

  const handleRemoved = (provider: "google_drive" | "onedrive") =>
    setConnections((prev) => prev.filter((c) => c.provider !== provider));

  const handleUpdated = (updated: DriveConnectionData) =>
    setConnections((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  return (
    <>
      <DriveCard
        provider="google_drive"
        orgId={orgId}
        connection={getConn("google_drive")}
        onConnectionRemoved={handleRemoved}
        onConnectionUpdated={handleUpdated}
      />
      <DriveCard
        provider="onedrive"
        orgId={orgId}
        connection={getConn("onedrive")}
        onConnectionRemoved={handleRemoved}
        onConnectionUpdated={handleUpdated}
      />
    </>
  );
}
