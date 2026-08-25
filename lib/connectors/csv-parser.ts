import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  NormalizedTransaction,
  CsvColumnMapping,
  normalizeCsvRow,
} from "@/lib/normalizer";

// ─── Auto-detect mapping from headers ─────────────────────────────────────────

export function autoDetectMapping(
  headers: string[]
): Partial<CsvColumnMapping> {
  const mapping: Partial<CsvColumnMapping> = {};

  for (const header of headers) {
    const lower = header.toLowerCase().trim();

    if (!mapping.dateCol && /date|time|dt|txn.?date|trans.?date/.test(lower)) {
      mapping.dateCol = header;
    }

    if (
      !mapping.amountCol &&
      /^amount$|^amt$|amount\s*\(|debit.?amount|credit.?amount|txn.?amount|value/.test(
        lower
      )
    ) {
      mapping.amountCol = header;
    }

    if (
      !mapping.typeCol &&
      /^type$|txn.?type|transaction.?type|cr\/dr|debit.?credit/.test(lower)
    ) {
      mapping.typeCol = header;
    }

    if (
      !mapping.descriptionCol &&
      /description|narration|particulars|remarks|memo|details|note/.test(lower)
    ) {
      mapping.descriptionCol = header;
    }

    if (
      !mapping.counterpartyCol &&
      /counterparty|payee|payer|vendor|merchant|beneficiary|name/.test(lower)
    ) {
      mapping.counterpartyCol = header;
    }

    if (!mapping.currencyCol && /^currency$|curr/.test(lower)) {
      mapping.currencyCol = header;
    }
  }

  return mapping;
}

// ─── Worksheet → header + row objects (for multi-tab spreadsheet import) ──────

export function extractWorksheet(
  ws: XLSX.WorkSheet
): { headers: string[]; rows: Record<string, string>[] } {
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd",
  });
  if (aoa.length < 1) return { headers: [], rows: [] };
  const headers = (aoa[0] as unknown[]).map((h) => String(h ?? "").trim());
  const rows = aoa.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = String((r as unknown[])[i] ?? "").trim(); });
    return obj;
  });
  return { headers, rows };
}

/** Public wrapper so link/sheet importers can normalize pre-extracted rows. */
export function transactionsFromRows(
  rows: Record<string, string>[],
  mapping: CsvColumnMapping
): NormalizedTransaction[] {
  return rowsToTransactions(rows, mapping);
}

// ─── Parse CSV rows into NormalizedTransaction[] ──────────────────────────────

function rowsToTransactions(
  rows: Record<string, string>[],
  mapping: CsvColumnMapping
): NormalizedTransaction[] {
  const results: NormalizedTransaction[] = [];

  for (const row of rows) {
    // Skip completely empty rows
    const values = Object.values(row);
    if (values.every((v) => !v || !v.trim())) continue;

    // Skip rows where required columns are missing
    if (!row[mapping.dateCol] && !row[mapping.amountCol]) continue;

    try {
      results.push(normalizeCsvRow(row, mapping));
    } catch {
      // Skip malformed rows silently
    }
  }

  return results;
}

// ─── Parse CSV file ───────────────────────────────────────────────────────────

export async function parseCsvFile(
  file: File | string,
  mapping: CsvColumnMapping
): Promise<NormalizedTransaction[]> {
  return new Promise((resolve, reject) => {
    const parseOptions = {
      header: true,
      skipEmptyLines: true,
      delimiter: "", // auto-detect
      transformHeader: (h: string) => h.trim(),
      transform: (v: string) => v.trim(),
      complete(results: Papa.ParseResult<Record<string, string>>) {
        try {
          const transactions = rowsToTransactions(results.data, mapping);
          resolve(transactions);
        } catch (err) {
          reject(err);
        }
      },
      error(err: Error) {
        reject(new Error(`CSV parse error: ${err.message}`));
      },
    };

    if (typeof file === "string") {
      Papa.parse<Record<string, string>>(file, parseOptions);
    } else {
      // Read File as text first, then parse
      const reader = new FileReader();
      reader.onload = (e) => {
        Papa.parse<Record<string, string>>(e.target?.result as string ?? "", parseOptions);
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    }
  });
}

// ─── Parse Excel file ─────────────────────────────────────────────────────────

export async function parseExcelFile(
  buffer: ArrayBuffer,
  mapping: CsvColumnMapping
): Promise<NormalizedTransaction[]> {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Excel file contains no sheets");
  }

  const sheet = workbook.Sheets[sheetName];

  // Convert to array of arrays for header detection
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: false, // format dates as strings
    dateNF: "yyyy-mm-dd",
  });

  if (aoa.length < 2) {
    return []; // no data rows
  }

  const headers = (aoa[0] as string[]).map((h) => String(h ?? "").trim());
  const dataRows = aoa.slice(1);

  const rows: Record<string, string>[] = dataRows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = String((row as unknown[])[i] ?? "").trim();
    });
    return obj;
  });

  return rowsToTransactions(rows, mapping);
}
