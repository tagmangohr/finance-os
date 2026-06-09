import type { createServiceClient } from "@/lib/supabase/server";
import type { DriveColumnMapping } from "./types";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

// ─── Name normalisation ───────────────────────────────────────────────────────

/**
 * Strips the trailing copy-number suffix Google Drive / OneDrive appends when
 * files are duplicated, e.g. "orders (6).csv" → "orders.csv".
 * Also lowercases so the comparison is case-insensitive.
 *
 * Examples:
 *   "refern_earn_orders (6).csv" → "refern_earn_orders.csv"
 *   "Sales Report (2).xlsx"      → "sales report.xlsx"
 *   "payroll.csv"                → "payroll.csv"
 */
function normaliseName(fileName: string): string {
  const dotIdx = fileName.lastIndexOf(".");
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx)       : fileName;
  const ext  = dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase() : "";
  // Remove " (N)" at the end of the base name
  return base.replace(/\s*\(\d+\)\s*$/, "").trim().toLowerCase() + ext;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * For every brand-new file in `folderId` (mapping_confirmed=false AND never
 * synced), check whether a confirmed file in the same folder has the same
 * normalised base name (ignoring Google's copy-number suffix).  If so, copy
 * its column_mapping and set mapping_confirmed=true automatically.
 *
 * Returns the number of files that were auto-confirmed.
 *
 * Brand-new means: `column_mapping IS NULL` AND `last_sync_at IS NULL`
 * — so manually-reset mappings (has last_sync_at) are left alone.
 */
export async function autoConfirmNewFiles(
  supabase: ServiceClient,
  folderId:  string,
): Promise<number> {
  // ── Load confirmed files in this folder ────────────────────────────────────
  const { data: confirmed } = await supabase
    .from("drive_files")
    .select("file_name, column_mapping")
    .eq("folder_id", folderId)
    .eq("mapping_confirmed", true)
    .not("column_mapping", "is", null);

  if (!confirmed || confirmed.length === 0) return 0;

  // Build a lookup: normalised name → column mapping
  const mappingByNorm = new Map<string, DriveColumnMapping>();
  for (const f of confirmed) {
    mappingByNorm.set(normaliseName(f.file_name), f.column_mapping as DriveColumnMapping);
  }

  // ── Load brand-new (never mapped, never synced) files in this folder ───────
  const { data: brandNew } = await supabase
    .from("drive_files")
    .select("id, file_name")
    .eq("folder_id", folderId)
    .eq("mapping_confirmed", false)
    .is("column_mapping", null)
    .is("last_sync_at", null);

  if (!brandNew || brandNew.length === 0) return 0;

  // ── Apply matching mappings ────────────────────────────────────────────────
  let confirmed_count = 0;

  for (const f of brandNew) {
    const norm    = normaliseName(f.file_name);
    const mapping = mappingByNorm.get(norm);
    if (!mapping) continue;

    const { error } = await supabase
      .from("drive_files")
      .update({ column_mapping: mapping, mapping_confirmed: true })
      .eq("id", f.id);

    if (!error) confirmed_count++;
  }

  return confirmed_count;
}
