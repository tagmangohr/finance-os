import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import type { NormalizedTransaction, CsvColumnMapping } from "@/lib/normalizer";
import { parseCsvFile, parseExcelFile, autoDetectMapping, extractWorksheet, transactionsFromRows } from "@/lib/connectors/csv-parser";
import { replaceConnectorTransactions, mergeConnectorTransactions } from "@/lib/connectors/sync";

/** Per-tab import config stored on a google_sheets connector: config.tabs[]. */
export type SheetTabConfig = {
  name: string;                      // worksheet (tab) name
  import?: boolean;                  // false = skip this tab
  ledger?: "bank" | "payments";      // destination; bank → lands uncategorized in Review
  mapping?: Partial<CsvColumnMapping>;
};

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
  { name: string; rowCount: number; headers: string[]; suggested: Partial<CsvColumnMapping> }[]
> {
  const buf = await fetchBytes(googleSheetXlsxUrl(sheetUrl));
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => {
    const { headers, rows } = extractWorksheet(wb.Sheets[name]);
    return { name, rowCount: rows.length, headers, suggested: autoDetectMapping(headers) };
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
        const mapping = finalizeMapping(headers, tab.mapping ?? {});
        const ledger: "bank" | "payments" = tab.ledger === "bank" ? "bank" : "payments";
        for (const t of transactionsFromRows(tabRows, mapping)) {
          if (!validDate(t.transaction_date)) continue;
          rows.push({
            ...t,
            ledger,
            // Tag bank rows with the tab name so each synced source is a filterable
            // "account" on the Bank page.
            account_type: ledger === "bank" ? tab.name : (t.account_type ?? null),
            external_id: sheetExternalId(tab.name, t.raw),
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
