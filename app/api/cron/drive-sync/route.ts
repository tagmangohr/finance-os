import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncDriveFile } from "@/lib/drive/sync";
import type { DriveConnection, DriveFile } from "@/lib/drive/types";

/**
 * GET /api/cron/drive-sync
 *
 * Vercel Cron job — runs every hour.
 * Finds all drive files that:
 *   1. Have a confirmed column mapping
 *   2. Have not been synced in the last 55 minutes (to avoid overlapping runs)
 *
 * Then checks each file's etag against what we stored — if the file changed,
 * or has never been synced, it re-syncs.
 *
 * Requires Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "Cron is not configured (missing CRON_SECRET)" }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  // ── Find files due for a check ─────────────────────────────────────────────
  const cutoff = new Date(Date.now() - 55 * 60 * 1000).toISOString();

  const { data: files, error: filesErr } = await supabase
    .from("drive_files")
    .select("*, drive_folders!inner(*, drive_connections!inner(*))")
    .eq("mapping_confirmed", true)
    .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`)
    .limit(50); // safety cap per run

  if (filesErr) {
    return NextResponse.json({ error: filesErr.message }, { status: 500 });
  }

  if (!files || files.length === 0) {
    return NextResponse.json({ message: "No drive files due for sync", synced: 0 });
  }

  type FileWithJoins = DriveFile & {
    drive_folders: { org_id: string; drive_connections: DriveConnection };
  };

  const summary: Array<{
    file: string;
    status: "synced" | "skipped" | "error";
    inserted?: number;
    updated?: number;
    reason?: string;
  }> = [];

  let totalInserted = 0;
  let totalUpdated  = 0;

  for (const rawFile of files as FileWithJoins[]) {
    const connection = rawFile.drive_folders.drive_connections;

    try {
      const result = await syncDriveFile({ supabase, connection, file: rawFile });
      totalInserted += result.inserted;
      totalUpdated  += result.updated;
      summary.push({
        file:     rawFile.file_name,
        status:   "synced",
        inserted: result.inserted,
        updated:  result.updated,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message.slice(0, 100) : String(err);
      summary.push({ file: rawFile.file_name, status: "error", reason });
      console.error(`[cron/drive-sync] Error syncing ${rawFile.file_name}:`, err);
    }
  }

  console.log(
    `[cron/drive-sync] ${new Date().toISOString()} — ${files.length} files checked, ${totalInserted} new txns, ${totalUpdated} updated`
  );

  return NextResponse.json({
    message:  "OK",
    inserted: totalInserted,
    updated:  totalUpdated,
    detail:   summary,
  });
}
