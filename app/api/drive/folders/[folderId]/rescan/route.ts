import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isTokenExpired } from "@/lib/drive/oauth";
import { refreshGoogleToken, listGoogleFolderFiles } from "@/lib/drive/google";
import { refreshOnedriveToken, listOnedriveFolderFiles, parseOnedriveFolderUrl } from "@/lib/drive/onedrive";
import { autoConfirmNewFiles } from "@/lib/drive/auto-confirm";
import type { DriveConnection, DriveFolder } from "@/lib/drive/types";

/**
 * POST /api/drive/folders/[folderId]/rescan
 *
 * Re-scans a tracked folder for new CSV/Excel files without touching the
 * column mappings of files already confirmed.  Any file that is brand new
 * (not yet in drive_files) gets a new row with mapping_confirmed = false.
 * Existing files have their etag / modified_at refreshed so the sync cron
 * can detect changes, but their column_mapping is never overwritten.
 *
 * Returns the folder with its updated file list.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
): Promise<NextResponse> {
  const { folderId } = await params;

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServiceClient();

  // ── Load folder + connection ───────────────────────────────────────────────
  const { data: folderData, error: folderErr } = await supabase
    .from("drive_folders")
    .select("*, drive_connections!inner(*)")
    .eq("id", folderId)
    .single();

  if (folderErr || !folderData) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  type FolderWithConn = DriveFolder & { drive_connections: DriveConnection };
  const folder = folderData as FolderWithConn;
  const conn   = folder.drive_connections;

  // Verify org ownership
  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", folder.org_id)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    // ── Refresh token if needed ──────────────────────────────────────────────
    let accessToken = conn.access_token;
    if (isTokenExpired(conn.token_expiry)) {
      if (!conn.refresh_token) {
        return NextResponse.json(
          { error: "Drive access has expired. Please reconnect your account." },
          { status: 401 }
        );
      }
      const refreshed =
        conn.provider === "google_drive"
          ? await refreshGoogleToken(conn.refresh_token)
          : await refreshOnedriveToken(conn.refresh_token);
      accessToken = refreshed.access_token;
      await supabase
        .from("drive_connections")
        .update({ access_token: refreshed.access_token, token_expiry: refreshed.expiry, updated_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    // ── Re-list files (includes subfolders, same logic as initial scan) ──────
    let providerFiles;
    if (conn.provider === "google_drive") {
      providerFiles = await listGoogleFolderFiles(accessToken, folder.provider_folder_id);
    } else {
      const parsed = parseOnedriveFolderUrl(folder.folder_url);
      if (!parsed) {
        return NextResponse.json({ error: "Could not parse OneDrive folder URL" }, { status: 422 });
      }
      providerFiles = await listOnedriveFolderFiles(accessToken, parsed.value, parsed.type);
    }

    if (providerFiles.length > 0) {
      const fileRows = providerFiles.map((f) => ({
        org_id:           folder.org_id,
        folder_id:        folderId,
        provider_file_id: f.id,
        file_name:        f.name,
        mime_type:        f.mimeType,
        last_etag:        f.etag,
        last_modified_at: f.modifiedAt,
        // column_mapping and mapping_confirmed are intentionally excluded —
        // Supabase upsert only updates the columns listed here, so existing
        // confirmed mappings are preserved.
      }));

      await supabase
        .from("drive_files")
        .upsert(fileRows, { onConflict: "folder_id,provider_file_id", ignoreDuplicates: false });
    }

    // ── Auto-confirm new files whose base name matches a confirmed file ───────
    // e.g. "orders (7).csv" inherits mapping from "orders (6).csv" automatically.
    const autoConfirmed = await autoConfirmNewFiles(supabase, folderId);

    // ── Update last_scan_at ──────────────────────────────────────────────────
    await supabase
      .from("drive_folders")
      .update({ last_scan_at: new Date().toISOString() })
      .eq("id", folderId);

    // ── Return the refreshed folder + file list ──────────────────────────────
    const { data: result } = await supabase
      .from("drive_folders")
      .select("*, drive_files(*)")
      .eq("id", folderId)
      .single();

    // Count brand-new files still needing manual mapping
    const needsMapping = (result?.drive_files ?? []).filter(
      (f: { mapping_confirmed: boolean; last_sync_at: string | null }) =>
        !f.mapping_confirmed && !f.last_sync_at
    ).length;

    return NextResponse.json({ ...result, new_files_found: needsMapping + autoConfirmed, auto_confirmed: autoConfirmed });
  } catch (err) {
    console.error("[drive/folders/rescan]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Rescan failed" },
      { status: 500 }
    );
  }
}
