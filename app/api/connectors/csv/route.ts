import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { parseCsvFile, parseExcelFile, autoDetectMapping } from "@/lib/connectors/csv-parser";
import { CsvColumnMapping, NormalizedTransaction } from "@/lib/normalizer";
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

  // ── Upsert into Supabase ──────────────────────────────────────────────────
  const supabase = await createServiceClient();

  // Validate connector belongs to org
  const { data: connector, error: connErr } = await supabase
    .from("connectors")
    .select("id, org_id")
    .eq("id", connectorId)
    .eq("org_id", orgId)
    .single();

  if (connErr || !connector) {
    return NextResponse.json(
      { error: "Connector not found", details: connErr?.message },
      { status: 404 }
    );
  }

  let imported = 0;
  if (normalized.length > 0) {
    const rows: TransactionInsert[] = normalized.map((tx) => ({
      org_id: orgId,
      connector_id: connectorId,
      external_id: tx.external_id,
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
    }));

    // CSV rows don't have external_id so we insert (may create duplicates on
    // re-upload — caller should deduplicate or use a hash-based external_id)
    const { error: insertErr, count } = await supabase
      .from("transactions")
      .insert(rows, { count: "exact" });

    if (insertErr) {
      return NextResponse.json(
        { error: "Failed to insert transactions", details: insertErr.message },
        { status: 500 }
      );
    }

    imported = count ?? rows.length;
    skipped = normalized.length - (count ?? rows.length);
  }

  // ── Update connector last_synced_at ───────────────────────────────────────
  await supabase
    .from("connectors")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", connectorId);

  return NextResponse.json({ imported, skipped });
}
