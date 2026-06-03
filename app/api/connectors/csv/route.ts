import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { isAuthFailure, requireConnectorAccess } from "@/lib/api/auth";
import { parseCsvFile, parseExcelFile, autoDetectMapping } from "@/lib/connectors/csv-parser";
import { CsvColumnMapping, NormalizedTransaction } from "@/lib/normalizer";
import { getExistingExternalIds } from "@/lib/db/dedup";
import type { Database } from "@/lib/supabase/types";

type TransactionInsert =
  Database["public"]["Tables"]["transactions"]["Insert"];

// ─── POST /api/connectors/csv ─────────────────────────────────────────────────
// Multipart form fields: file, org_id, connector_id, mapping (JSON string)

export async function POST(req: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Failed to parse multipart form data" },
      { status: 400 }
    );
  }

  const orgId = formData.get("org_id");
  const connectorId = formData.get("connector_id");
  const mappingRaw = formData.get("mapping");
  const fileEntry = formData.get("file");

  if (!orgId || typeof orgId !== "string") {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }
  if (!connectorId || typeof connectorId !== "string") {
    return NextResponse.json(
      { error: "connector_id is required" },
      { status: 400 }
    );
  }
  if (!fileEntry || !(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: "file is required and must be a File" },
      { status: 400 }
    );
  }

  const auth = await requireConnectorAccess(connectorId, { orgId });
  if (isAuthFailure(auth)) return auth.error;

  // ── Parse column mapping (partial allowed — auto-detect fills gaps) ────────
  let mapping: Partial<CsvColumnMapping> = {};
  if (mappingRaw && typeof mappingRaw === "string") {
    try {
      mapping = JSON.parse(mappingRaw) as Partial<CsvColumnMapping>;
    } catch {
      return NextResponse.json(
        { error: "mapping must be valid JSON" },
        { status: 400 }
      );
    }
  }

  // ── Determine file type ───────────────────────────────────────────────────
  const fileName = fileEntry.name.toLowerCase();
  const mimeType = fileEntry.type.toLowerCase();
  const isExcel =
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("excel") ||
    mimeType.includes("ms-excel") ||
    fileName.endsWith(".xlsx") ||
    fileName.endsWith(".xls");

  // ── Parse file ────────────────────────────────────────────────────────────
  let normalized: NormalizedTransaction[] = [];
  let skipped = 0;

  try {
    if (isExcel) {
      const buffer = await fileEntry.arrayBuffer();
      // Peek headers for auto-detect if mapping is incomplete
      const { utils, read } = await import("xlsx");
      const wb = read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa: unknown[][] = utils.sheet_to_json(ws, { header: 1, defval: "" });
      const headers = (aoa[0] as string[]).map((h) => String(h ?? "").trim());
      const detected = autoDetectMapping(headers);
      const finalMapping: CsvColumnMapping = {
        dateCol: mapping.dateCol ?? detected.dateCol ?? headers[0],
        amountCol: mapping.amountCol ?? detected.amountCol ?? headers[1],
        typeCol: mapping.typeCol ?? detected.typeCol,
        descriptionCol: mapping.descriptionCol ?? detected.descriptionCol,
        counterpartyCol: mapping.counterpartyCol ?? detected.counterpartyCol,
        currencyCol: mapping.currencyCol ?? detected.currencyCol,
      };
      normalized = await parseExcelFile(buffer, finalMapping);
    } else {
      // Read file text for header detection
      const text = await fileEntry.text();

      // Detect headers from first line
      const firstLine = text.split("\n")[0] ?? "";
      // Try auto-detect delimiter: comma, semicolon, tab, pipe
      const headerCells = firstLine.includes("\t")
        ? firstLine.split("\t")
        : firstLine.includes(";")
        ? firstLine.split(";")
        : firstLine.split(",");
      const headers = headerCells.map((h) => h.trim().replace(/^"|"$/g, ""));
      const detected = autoDetectMapping(headers);
      const finalMapping: CsvColumnMapping = {
        dateCol: mapping.dateCol ?? detected.dateCol ?? headers[0],
        amountCol: mapping.amountCol ?? detected.amountCol ?? headers[1],
        typeCol: mapping.typeCol ?? detected.typeCol,
        descriptionCol: mapping.descriptionCol ?? detected.descriptionCol,
        counterpartyCol: mapping.counterpartyCol ?? detected.counterpartyCol,
        currencyCol: mapping.currencyCol ?? detected.currencyCol,
      };
      normalized = await parseCsvFile(text, finalMapping);
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to parse file",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 422 }
    );
  }

  let imported = 0;
  if (normalized.length > 0) {
    const fingerprintCounts = new Map<string, number>();
    const rows: TransactionInsert[] = normalized.map((tx) => {
      const baseId = tx.external_id ?? csvExternalId(tx);
      const count = fingerprintCounts.get(baseId) ?? 0;
      fingerprintCounts.set(baseId, count + 1);

      return {
        org_id: auth.org.id,
        connector_id: connectorId,
        external_id: count === 0 ? baseId : `${baseId}_${count + 1}`,
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        category: tx.category,
        category_confidence: null,
        counterparty_id: null,
        counterparty_name: tx.counterparty_name,
        description: tx.description,
        source: tx.source,
        status: tx.status,
        transaction_date: tx.transaction_date,
        metadata: tx.metadata as import("@/lib/supabase/types").Json,
      };
    });

    const externalIds = rows.map((row) => row.external_id).filter(Boolean) as string[];
    const existingIds = await getExistingExternalIds(
      auth.supabase,
      auth.org.id,
      externalIds
    );
    const newRows = rows.filter(
      (row) => !row.external_id || !existingIds.has(row.external_id)
    );

    if (newRows.length > 0) {
      const { error: insertErr, count } = await auth.supabase
        .from("transactions")
        .insert(newRows, { count: "exact" });

      if (insertErr) {
        return NextResponse.json(
          { error: "Failed to insert transactions", details: insertErr.message },
          { status: 500 }
        );
      }

      imported = count ?? newRows.length;
    }

    skipped = rows.length - imported;
  }

  // ── Update connector last_synced_at ───────────────────────────────────────
  await auth.supabase
    .from("connectors")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connectorId);

  return NextResponse.json({ imported, skipped });
}

function csvExternalId(tx: NormalizedTransaction): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        counterparty_name: tx.counterparty_name,
        description: tx.description,
        transaction_date: tx.transaction_date,
        raw: tx.metadata.raw,
      })
    )
    .digest("hex")
    .slice(0, 24);

  return `csv_${hash}`;
}
