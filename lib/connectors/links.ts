import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import type { NormalizedTransaction, CsvColumnMapping } from "@/lib/normalizer";
import { parseCsvFile, parseExcelFile, autoDetectMapping, extractWorksheet, buildTabTransactions, suggestTabSpec, type TabParseSpec } from "@/lib/connectors/csv-parser";
import { replaceConnectorTransactions, mergeConnectorTransactions } from "@/lib/connectors/sync";

/** Per-tab import config stored on a google_sheets connector: config.tabs[].
 *  Beyond destination (import/ledger) it carries the parse spec so bank statements
 *  (split Withdrawal/Deposit), all-expense registers (fixed direction) and payroll
 *  grids (matrix) each read correctly. Anything left unset falls back to the
 *  auto-detected suggestTabSpec() for that tab's headers. */
export type SheetTabConfig = {
  name: string;                      // worksheet (tab) name
  import?: boolean;                  // false = skip this tab
  ledger?: "bank" | "payments";      // destination; bank → lands uncategorized in Review
  format?: "single" | "split" | "matrix";
  // single + split column mapping (flat):
  dateCol?: string;
  amountCol?: string;
  typeCol?: string;
  descriptionCol?: string;
  counterpartyCol?: string;
  currencyCol?: string;
  direction?: "auto" | "debit" | "credit"; // single: force the sign
  debitCol?: string;                 // split: withdrawal → debit
  creditCol?: string;                // split: deposit → credit
  labelCol?: string;                 // matrix: label/counterparty column
  valueCols?: string[];              // matrix: period value columns
  matrixDirection?: "debit" | "credit";
  mapping?: Partial<CsvColumnMapping>; // legacy (older configs) — still honoured
};

/** Resolve a tab's saved config into a concrete parse spec, filling any unset
 *  field from the header-based auto-detection so old/partial configs still work. */
function resolveTabSpec(tab: SheetTabConfig, headers: string[]): TabParseSpec {
  const s = suggestTabSpec(headers);
  const legacy = (tab.mapping ?? {}) as Partial<CsvColumnMapping>;
  return {
    format: tab.format ?? s.format,
    dateCol: tab.dateCol ?? legacy.dateCol ?? s.dateCol,
    amountCol: tab.amountCol ?? legacy.amountCol ?? s.amountCol,
    typeCol: tab.typeCol ?? legacy.typeCol ?? s.typeCol,
    descriptionCol: tab.descriptionCol ?? legacy.descriptionCol ?? s.descriptionCol,
    counterpartyCol: tab.counterpartyCol ?? legacy.counterpartyCol ?? s.counterpartyCol,
    currencyCol: tab.currencyCol ?? legacy.currencyCol ?? s.currencyCol,
    direction: tab.direction ?? s.direction ?? "auto",
    debitCol: tab.debitCol ?? s.debitCol,
    creditCol: tab.creditCol ?? s.creditCol,
    labelCol: tab.labelCol ?? s.labelCol,
    // For a MATRIX (payroll) tab, ALWAYS take the freshly auto-detected period
    // columns — never the frozen saved list — so a newly-added month column (e.g.
    // "August 2026" appearing next payroll cycle) is picked up automatically instead
    // of being silently skipped. Fall back to the saved list only if detection finds
    // none. (For non-matrix, the saved mapping wins.)
    valueCols: (tab.format ?? s.format) === "matrix" ? (s.valueCols ?? tab.valueCols) : (tab.valueCols ?? s.valueCols),
    matrixDirection: tab.matrixDirection ?? s.matrixDirection ?? "debit",
  };
}

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

const LINK_TYPES = new Set(["google_sheets", "excel"]);
/** Link connectors live-sync a public URL (Google Sheet / online Excel) by
 *  re-reading + mirroring it each sync, instead of pulling from a gateway. */
export function isLinkConnector(type: string): boolean {
  return LINK_TYPES.has(type);
}

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 25 * 1024 * 1024;

// ─── SSRF guard ───────────────────────────────────────────────────────────────
// User-supplied URLs are fetched server-side, so block non-https and any host
// that could point at internal infrastructure.
function safeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That isn't a valid URL.");
  }
  if (u.protocol !== "https:") throw new Error("Only https links are supported.");
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("That host isn't allowed.");
  }
  return u;
}

// ─── Google Sheets link → CSV export URL ──────────────────────────────────────
export function googleSheetCsvUrl(sheetUrl: string): string {
  const u = safeUrl(sheetUrl);
  if (u.hostname !== "docs.google.com") throw new Error("That isn't a Google Sheets link.");
  const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error("Couldn't find the spreadsheet ID in that link.");
  const id = m[1];
  // tab id ("gid") may be in the query or the #fragment
  let gid = u.searchParams.get("gid");
  if (!gid && u.hash) {
    const hm = u.hash.match(/gid=([0-9]+)/);
    if (hm) gid = hm[1];
  }
  const params = new URLSearchParams({ format: "csv" });
  if (gid) params.set("gid", gid);
  return `https://docs.google.com/spreadsheets/d/${id}/export?${params.toString()}`;
}

/** Whole-spreadsheet XLSX export (contains ALL tabs) — used for multi-tab import. */
export function googleSheetXlsxUrl(sheetUrl: string): string {
  const u = safeUrl(sheetUrl);
  if (u.hostname !== "docs.google.com") throw new Error("That isn't a Google Sheets link.");
  const m = u.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error("Couldn't find the spreadsheet ID in that link.");
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
}

/** Stable id for a sheet row so merge-sync can preserve edits/categorization. */
function sheetExternalId(tab: string, raw: unknown): string {
  const h = createHash("sha256").update(`${tab}|${JSON.stringify(raw ?? {})}`).digest("hex").slice(0, 24);
  return `gsheet_${h}`;
}

/** List every tab in a Google Sheet with headers + an auto-suggested mapping.
 *  Powers the per-tab "which sub-sheet goes where" setup screen. */
export async function listSheetTabs(sheetUrl: string): Promise<
  { name: string; rowCount: number; headers: string[]; suggested: TabParseSpec }[]
> {
  const buf = await fetchBytes(googleSheetXlsxUrl(sheetUrl));
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => {
    const { headers, rows } = extractWorksheet(wb.Sheets[name]);
    return { name, rowCount: rows.length, headers, suggested: suggestTabSpec(headers) };
  });
}

// ─── Excel share link → direct-download URL ───────────────────────────────────
export function excelDownloadUrl(fileUrl: string): string {
  const u = safeUrl(fileUrl);
  const host = u.hostname.toLowerCase();

  // Google Drive file → direct download
  if (host === "drive.google.com" || host === "drive.usercontent.google.com") {
    const idFromPath = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1];
    const id = idFromPath ?? u.searchParams.get("id");
    if (!id) throw new Error("Couldn't find the Drive file ID in that link.");
    return `https://drive.google.com/uc?export=download&id=${id}`;
  }

  // OneDrive personal share → shares API content endpoint (works for
  // "anyone with the link" shares, no auth). Token = u!<base64url(url)>.
  if (host === "1drv.ms" || host.endsWith("onedrive.live.com")) {
    const b64 = Buffer.from(fileUrl).toString("base64").replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");
    return `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`;
  }

  // Otherwise assume a direct link to the file bytes.
  return fileUrl;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) throw new Error(`Couldn't read the link (HTTP ${res.status}).`);
  const text = await res.text();
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error("The sheet isn't public. In Google Sheets → Share → 'Anyone with the link' → Viewer, then paste the link again.");
  }
  return text;
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "follow" });
  if (!res.ok) throw new Error(`Couldn't download the file (HTTP ${res.status}).`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new Error("The file was empty or isn't publicly downloadable.");
  if (buf.byteLength > MAX_BYTES) throw new Error("That file is too large (max 25 MB).");
  return buf;
}

function finalizeMapping(
  headers: string[],
  override: Partial<CsvColumnMapping>
): CsvColumnMapping {
  const detected = autoDetectMapping(headers);
  return {
    dateCol: override.dateCol ?? detected.dateCol ?? headers[0] ?? "",
    amountCol: override.amountCol ?? detected.amountCol ?? headers[1] ?? "",
    typeCol: override.typeCol ?? detected.typeCol,
    descriptionCol: override.descriptionCol ?? detected.descriptionCol,
    counterpartyCol: override.counterpartyCol ?? detected.counterpartyCol,
    currencyCol: override.currencyCol ?? detected.currencyCol,
  };
}

function csvHeaders(text: string): string[] {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    preview: 1,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return (res.meta.fields ?? []).filter(Boolean);
}

function excelHeaders(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const name = wb.SheetNames[0];
  if (!name) throw new Error("The Excel file has no sheets.");
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "" });
  return ((aoa[0] as unknown[]) ?? []).map((h) => String(h ?? "").trim());
}

/** Fetch + parse a link connector's source into normalized transactions. */
export async function fetchLinkTransactions(
  connector: Pick<ConnectorRow, "type" | "config">
): Promise<NormalizedTransaction[]> {
  const cfg = (connector.config ?? {}) as Record<string, unknown>;
  const override = (cfg.mapping && typeof cfg.mapping === "object" ? cfg.mapping : {}) as Partial<CsvColumnMapping>;

  const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d); // drop unparseable dates (can't store)

  let rows: NormalizedTransaction[];
  if (connector.type === "google_sheets") {
    const sheetUrl = String(cfg.sheet_url ?? "");
    const tabsCfg = Array.isArray((cfg as { tabs?: unknown }).tabs) ? ((cfg as { tabs: SheetTabConfig[] }).tabs) : null;

    if (tabsCfg && tabsCfg.some((t) => t.import !== false)) {
      // Multi-tab: read the whole spreadsheet as XLSX, import each selected tab to
      // its chosen ledger (bank tabs land uncategorized → Review). Stable id per row.
      const buf = await fetchBytes(googleSheetXlsxUrl(sheetUrl));
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      rows = [];
      for (const tab of tabsCfg) {
        if (tab.import === false) continue;
        const ws = wb.Sheets[tab.name];
        if (!ws) continue;
        const { headers, rows: tabRows } = extractWorksheet(ws);
        const spec = resolveTabSpec(tab, headers);
        const ledger: "bank" | "payments" = tab.ledger === "bank" ? "bank" : "payments";
        for (const t of buildTabTransactions(tabRows, headers, spec)) {
          if (!validDate(t.transaction_date)) continue;
          // Stable external_id basis. For a MATRIX (payroll grid) key by (label,
          // period column) ONLY — NOT the whole row — so editing/filling one month
          // for an employee doesn't re-hash (and thus re-key + drop the category of)
          // that employee's OTHER months. For single/split, the row IS the unit.
          const idBasis = spec.format === "matrix"
            ? { label: t.counterparty_name ?? "", col: (t.metadata as Record<string, unknown> | undefined)?.source_column ?? "" }
            : t.raw;
          rows.push({
            ...t,
            ledger,
            // Tag bank rows with the tab name so each synced source is a filterable
            // "account" on the Bank page.
            account_type: ledger === "bank" ? tab.name : (t.account_type ?? null),
            external_id: sheetExternalId(tab.name, idBasis),
          });
        }
      }
    } else {
      // Legacy single-tab (no per-tab config) — still stamp a stable id so merge works.
      const text = await fetchText(googleSheetCsvUrl(sheetUrl));
      const parsed = await parseCsvFile(text, finalizeMapping(csvHeaders(text), override));
      rows = parsed
        .filter((t) => validDate(t.transaction_date))
        .map((t) => ({ ...t, external_id: sheetExternalId("__single__", t.raw) }));
    }
  } else if (connector.type === "excel") {
    const buf = await fetchBytes(excelDownloadUrl(String(cfg.file_url ?? "")));
    rows = await parseExcelFile(buf, finalizeMapping(excelHeaders(buf), override));
  } else {
    throw new Error(`Not a link connector: ${connector.type}`);
  }
  // The CSV normalizer hardcodes source="csv"; tag with the real connector type
  // so the Raw Data source column / per-source grouping is accurate.
  return rows.map((r) => ({ ...r, source: connector.type }));
}

/** Live-sync a link connector: re-read the source and mirror it into transactions. */
export async function syncLinkConnector(
  supabase: SupabaseLike,
  connector: ConnectorRow
): Promise<{ inserted: number; fetched: number }> {
  const transactions = await fetchLinkTransactions(connector);
  // Google Sheets: MERGE (stable ids) so in-app edits/categorization survive re-sync.
  // Excel links have no stable id yet → keep the mirror (replace) behavior.
  if (connector.type === "google_sheets") {
    const { inserted, updated } = await mergeConnectorTransactions(
      supabase, connector.org_id, connector.id, transactions
    );
    return { inserted: inserted + updated, fetched: transactions.length };
  }
  const { inserted } = await replaceConnectorTransactions(
    supabase, connector.org_id, connector.id, transactions
  );
  return { inserted, fetched: transactions.length };
}
