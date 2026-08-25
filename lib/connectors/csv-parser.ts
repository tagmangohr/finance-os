import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  NormalizedTransaction,
  CsvColumnMapping,
  normalizeCsvRow,
  parseDateString,
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

// ─── Per-tab parsing (sheet connector) ────────────────────────────────────────
// A single amount column + sign is not enough for real-world sheets:
//  • bank statements have SEPARATE Withdrawal (debit) + Deposit (credit) columns;
//  • an all-expense register has positive amounts with no direction indicator;
//  • a payroll grid is a MATRIX (employee × month) that must be unpivoted.
// TabParseSpec + buildTabTransactions handle all three; the sheet connector maps
// each tab's saved config into a spec, falling back to suggestTabSpec()'s auto-
// detection for anything the user hasn't overridden.

export type TabFormat = "single" | "split" | "matrix";

export type TabParseSpec = {
  format: TabFormat;
  // single + split share these:
  dateCol?: string;
  descriptionCol?: string;
  counterpartyCol?: string;
  currencyCol?: string;
  // single:
  amountCol?: string;
  typeCol?: string;
  direction?: "auto" | "debit" | "credit"; // force the sign, or infer from typeCol/amount sign
  // split (bank statement): withdrawal → debit, deposit → credit
  debitCol?: string;
  creditCol?: string;
  // matrix (payroll grid): label column + one value column per period
  labelCol?: string;
  valueCols?: string[];
  matrixDirection?: "debit" | "credit";
};

/** Parse an Indian/US-formatted money string ("2,00,000.00", "₹1,043,798") → number. */
function cleanAmount(raw: string | undefined | null): number {
  if (raw == null) return 0;
  const c = String(raw).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(c);
  return isNaN(n) ? 0 : n;
}

const isIsoDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * Build normalized transactions from one worksheet's rows using an explicit spec.
 * `raw` carries a discriminator for split/matrix rows (which side / which cell) so
 * the sheet importer's per-row hash id stays unique when one source row expands
 * into several transactions.
 */
export function buildTabTransactions(
  rows: Record<string, string>[],
  headers: string[],
  spec: TabParseSpec
): NormalizedTransaction[] {
  const out: NormalizedTransaction[] = [];
  const format = spec.format ?? "single";

  if (format === "matrix") {
    const labelCol = spec.labelCol ?? headers[0] ?? "";
    const valueCols =
      spec.valueCols && spec.valueCols.length ? spec.valueCols : headers.filter((h) => h !== labelCol);
    const type: "credit" | "debit" = spec.matrixDirection === "credit" ? "credit" : "debit";
    for (const row of rows) {
      const label = (row[labelCol] ?? "").trim();
      for (const col of valueCols) {
        const amount = Math.abs(cleanAmount(row[col]));
        if (!amount) continue; // blank / zero cell → no transaction
        const date = parseDateString(col); // column header is the period (e.g. "July 2026")
        if (!isIsoDate(date)) continue;
        out.push({
          external_id: null,
          type,
          amount,
          currency: "INR",
          category: null,
          counterparty_name: label || null,
          description: label ? `${label} · ${col}` : col,
          source: "csv",
          status: "completed",
          transaction_date: date,
          metadata: { raw: row, source_column: col },
          raw: { ...row, __cell: col }, // discriminator → unique per-cell id
        });
      }
    }
    return out;
  }

  if (format === "split") {
    for (const row of rows) {
      const vals = Object.values(row);
      if (vals.every((v) => !v || !v.trim())) continue;
      const dateStr = parseDateString(row[spec.dateCol ?? ""] ?? "");
      const desc = spec.descriptionCol ? (row[spec.descriptionCol] ?? null) : null;
      const cp = spec.counterpartyCol ? (row[spec.counterpartyCol] ?? null) : null;
      const currency = spec.currencyCol ? (row[spec.currencyCol] ?? "INR").toUpperCase() : "INR";
      const debit = Math.abs(cleanAmount(spec.debitCol ? row[spec.debitCol] : ""));
      const credit = Math.abs(cleanAmount(spec.creditCol ? row[spec.creditCol] : ""));
      const sides: Array<["credit" | "debit", number]> = [];
      if (debit) sides.push(["debit", debit]);
      if (credit) sides.push(["credit", credit]);
      for (const [type, amount] of sides) {
        out.push({
          external_id: null,
          type,
          amount,
          currency,
          category: null,
          counterparty_name: cp && cp.trim() ? cp.trim() : null,
          description: desc && desc.trim() ? desc.trim() : null,
          source: "csv",
          status: "completed",
          transaction_date: dateStr,
          metadata: { raw: row },
          // Only add the side discriminator when a row produced BOTH (rare) so ids
          // stay unique; the common one-sided row keeps a clean raw payload.
          raw: sides.length > 1 ? { ...row, __side: type } : row,
        });
      }
    }
    return out;
  }

  // single column (+ optional direction override)
  const mapping: CsvColumnMapping = {
    dateCol: spec.dateCol ?? headers[0] ?? "",
    amountCol: spec.amountCol ?? headers[1] ?? "",
    typeCol: spec.typeCol,
    descriptionCol: spec.descriptionCol,
    counterpartyCol: spec.counterpartyCol,
    currencyCol: spec.currencyCol,
  };
  const dir = spec.direction ?? "auto";
  for (const row of rows) {
    const vals = Object.values(row);
    if (vals.every((v) => !v || !v.trim())) continue;
    if (!row[mapping.dateCol] && !row[mapping.amountCol]) continue;
    let tx: NormalizedTransaction;
    try {
      tx = normalizeCsvRow(row, mapping);
    } catch {
      continue;
    }
    if (dir === "debit") tx.type = "debit";
    else if (dir === "credit") tx.type = "credit";
    out.push(tx);
  }
  return out;
}

/**
 * Auto-detect a sensible parse spec from a tab's headers: a Withdrawal/Deposit
 * (or Debit/Credit) pair → split; ≥3 columns whose HEADERS are month-year labels
 * → matrix (payroll grid); otherwise single-column with the usual mapping.
 */
export function suggestTabSpec(headers: string[]): TabParseSpec {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (re: RegExp): string | undefined => headers.find((_, i) => re.test(lower[i]));

  // Split: separate money-out / money-in columns (exclude "credit card" / "debit card").
  const debitCol = find(/withdrawal|paid\s*out|money\s*out|(?<!\w)dr(?!\w)|debit(?!\s*card)/);
  const creditCol = find(/deposit|paid\s*in|money\s*in|(?<!\w)cr(?!\w)|credit(?!\s*card)/);
  if (debitCol && creditCol && debitCol !== creditCol) {
    return {
      format: "split",
      debitCol,
      creditCol,
      dateCol:
        find(/transaction\s*date/) ?? find(/value\s*date/) ?? find(/^date/) ?? find(/date/),
      descriptionCol: find(/remarks|narration|particulars|description|details/),
    };
  }

  // Matrix: many columns whose header parses as a month-year (a period grid).
  const monthCols = headers.filter((h) => isIsoDate(parseDateString(h)));
  if (monthCols.length >= 3) {
    const labelCol = headers.find((h) => !monthCols.includes(h)) ?? headers[0];
    return { format: "matrix", labelCol, valueCols: monthCols, matrixDirection: "debit" };
  }

  const m = autoDetectMapping(headers);
  return {
    format: "single",
    dateCol: m.dateCol,
    amountCol: m.amountCol,
    typeCol: m.typeCol,
    descriptionCol: m.descriptionCol,
    counterpartyCol: m.counterpartyCol,
    currencyCol: m.currencyCol,
    direction: "auto",
  };
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
