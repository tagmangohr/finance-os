import { createHash } from "crypto";
import { parse, isValid } from "date-fns";
import type { DriveColumnMapping } from "./types";
import type { NormalizedTransaction } from "@/lib/normalizer";

// ─── Date parsing ─────────────────────────────────────────────────────────────

const DATE_FORMATS = [
  "yyyy-MM-dd",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "dd-MM-yyyy",
  "MM-dd-yyyy",
  "dd MMM yyyy",
  "dd-MMM-yyyy",
  "d/M/yyyy",
  "d-M-yyyy",
  "yyyy/MM/dd",
  "yyyyMMdd",
];

function parseDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Already ISO-ish (yyyy-MM-dd or with time component)
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  for (const fmt of DATE_FORMATS) {
    const d = parse(trimmed, fmt, new Date(2000, 0, 1));
    if (isValid(d)) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  }

  // Last resort: native Date parse
  const native = new Date(trimmed);
  if (!Number.isNaN(native.getTime())) {
    return native.toISOString().slice(0, 10);
  }

  return null;
}

// ─── Amount parsing ───────────────────────────────────────────────────────────

function parseAmount(raw: string): number {
  if (!raw || !raw.trim()) return 0;
  // Strip currency symbols, commas, spaces
  const clean = raw.replace(/[₹$€£¥,\s]/g, "").trim();
  const num = parseFloat(clean);
  return Number.isFinite(num) ? num : 0;
}

// ─── Type inference ───────────────────────────────────────────────────────────

function inferType(typeRaw: string | undefined): "credit" | "debit" | null {
  if (!typeRaw) return null;
  const lower = typeRaw.toLowerCase().trim();
  if (/^(cr|credit|c|in|inflow|\+|deposit|received)$/.test(lower)) return "credit";
  if (/^(dr|debit|d|out|outflow|-|withdrawal|paid)$/.test(lower))   return "debit";
  return null;
}

// ─── Stable external ID ───────────────────────────────────────────────────────

/** Builds a stable external_id from a file ID + row content hash.
 *  If the row has a reference column, that is included for extra stability. */
function externalId(
  fileId: string,
  row: Record<string, string>,
  mapping: DriveColumnMapping
): string {
  const refVal = mapping.reference ? (row[mapping.reference] ?? "") : "";
  const dateVal = mapping.date ? (row[mapping.date] ?? "") : "";
  const amtVal = mapping.amount
    ? row[mapping.amount]
    : mapping.debit
    ? `D${row[mapping.debit] ?? ""}`
    : mapping.credit
    ? `C${row[mapping.credit] ?? ""}`
    : "";
  const descVal = mapping.description ? (row[mapping.description] ?? "").slice(0, 40) : "";

  const key = refVal
    ? `${fileId}:ref:${refVal}`
    : `${fileId}:${dateVal}:${amtVal}:${descVal}`;

  const hash = createHash("sha256").update(key).digest("hex").slice(0, 20);
  return `drive_${hash}`;
}

// ─── Main normalizer ──────────────────────────────────────────────────────────

/** Transforms raw spreadsheet rows into NormalizedTransaction[], skipping
 *  rows that are missing required fields (date + amount). */
export function normalizeDriverRows(
  rows: Record<string, string>[],
  mapping: DriveColumnMapping,
  fileId: string,
  defaultCurrency = "INR"
): NormalizedTransaction[] {
  const results: NormalizedTransaction[] = [];

  for (const row of rows) {
    // Skip completely empty rows
    const vals = Object.values(row);
    if (vals.every((v) => !v || !v.trim())) continue;

    // ── Resolve date ────────────────────────────────────────────────────────
    const rawDate = mapping.date ? row[mapping.date] ?? "" : "";
    const parsedDate = parseDate(rawDate);
    if (!parsedDate) continue; // date is required

    // ── Resolve amount and type ──────────────────────────────────────────────
    let type: "credit" | "debit";
    let amount: number;

    if (mapping.debit && mapping.credit) {
      // Separate debit/credit columns
      const debitAmt  = parseAmount(mapping.debit  ? row[mapping.debit]  ?? "" : "");
      const creditAmt = parseAmount(mapping.credit ? row[mapping.credit] ?? "" : "");

      if (creditAmt > 0) {
        type   = "credit";
        amount = creditAmt;
      } else if (debitAmt > 0) {
        type   = "debit";
        amount = debitAmt;
      } else {
        continue; // no usable amount
      }
    } else if (mapping.amount) {
      const raw = parseAmount(row[mapping.amount] ?? "");
      if (raw === 0) continue;

      if (mapping.type) {
        const inferred = inferType(row[mapping.type] ?? "");
        if (inferred) {
          type   = inferred;
          amount = Math.abs(raw);
        } else if (raw < 0) {
          type   = "debit";
          amount = Math.abs(raw);
        } else {
          type   = "credit";
          amount = raw;
        }
      } else {
        // Signed amount — positive = credit
        type   = raw >= 0 ? "credit" : "debit";
        amount = Math.abs(raw);
      }
    } else {
      continue; // no amount mapping at all
    }

    // ── Other fields ────────────────────────────────────────────────────────
    const description   = mapping.description   ? (row[mapping.description]   ?? "").trim() || null : null;
    const counterparty  = mapping.counterparty  ? (row[mapping.counterparty]  ?? "").trim() || null : null;
    const currency      = (mapping.currency     ? (row[mapping.currency]      ?? "").trim() : "") || defaultCurrency;

    results.push({
      external_id:      externalId(fileId, row, mapping),
      type,
      amount,
      currency:         currency.toUpperCase(),
      category:         null,
      counterparty_name: counterparty,
      description,
      source:           "drive",
      status:           "completed",
      transaction_date: parsedDate,
      metadata: {
        raw:            row,
        drive_file_id:  fileId,
      },
    });
  }

  return results;
}

// ─── Extract headers + sample rows from a buffer ─────────────────────────────

/** Returns the header array and up to maxSampleRows of data rows, for use
 *  in the AI mapping step.  Accepts CSV text or an Excel buffer. */
export async function extractHeadersAndSample(
  buffer: Buffer,
  mimeType: string,
  maxSampleRows = 5
): Promise<{ headers: string[]; sampleRows: string[][] }> {
  const isExcel =
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("ms-excel") ||
    mimeType.includes("excel");

  if (isExcel) {
    const { read, utils } = await import("xlsx");
    const wb = read(buffer, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return { headers: [], sampleRows: [] };

    const aoa: unknown[][] = utils.sheet_to_json(ws, {
      header:  1,
      defval:  "",
      raw:     false,
      dateNF:  "yyyy-mm-dd",
    });

    const headers = ((aoa[0] ?? []) as unknown[]).map((h) => String(h ?? "").trim());
    const sampleRows = (aoa.slice(1, 1 + maxSampleRows) as unknown[][]).map((row) =>
      headers.map((_, i) => String((row as unknown[])[i] ?? "").trim())
    );

    return { headers, sampleRows };
  }

  // CSV
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], sampleRows: [] };

  // Auto-detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

  const parseRow = (line: string) =>
    line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));

  const headers = parseRow(firstLine);
  const sampleRows = lines.slice(1, 1 + maxSampleRows).map(parseRow);

  return { headers, sampleRows };
}

// ─── Parse full spreadsheet into rows ────────────────────────────────────────

/** Parses a file buffer into an array of string-value row objects.
 *  Header values become the object keys. */
export async function parseFileToRows(
  buffer: Buffer,
  mimeType: string
): Promise<Record<string, string>[]> {
  const isExcel =
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("ms-excel") ||
    mimeType.includes("excel");

  if (isExcel) {
    const { read, utils } = await import("xlsx");
    const wb = read(buffer, { type: "buffer", cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return [];

    const aoa: unknown[][] = utils.sheet_to_json(ws, {
      header:  1,
      defval:  "",
      raw:     false,
      dateNF:  "yyyy-mm-dd",
    });

    if (aoa.length < 2) return [];
    const headers = ((aoa[0] ?? []) as unknown[]).map((h) => String(h ?? "").trim());

    return (aoa.slice(1) as unknown[][]).map((row) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = String((row as unknown[])[i] ?? "").trim(); });
      return obj;
    });
  }

  // CSV
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
  const parseRow = (line: string) =>
    line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ""));

  const headers = parseRow(firstLine);
  return lines.slice(1).map((line) => {
    const cells = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
    return obj;
  });
}
