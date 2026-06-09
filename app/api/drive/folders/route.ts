import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isTokenExpired } from "@/lib/drive/oauth";
import { refreshGoogleToken, listGoogleFolderFiles, getGoogleFolderName, parseGoogleFolderUrl } from "@/lib/drive/google";
import { refreshOnedriveToken, listOnedriveFolderFiles, getOnedriveFolderName, parseOnedriveFolderUrl } from "@/lib/drive/onedrive";
import { autoConfirmNewFiles } from "@/lib/drive/auto-confirm";
import type { DriveConnection } from "@/lib/drive/types";

/**
 * POST /api/drive/folders
 *
 * Body: { connection_id: string; folder_url: string }
 *
 * Parses the folder URL, fetches its file listing, and upserts:
 *   - A drive_folders row
 *   - A drive_files row for each discovered CSV/Excel file
 *
 * Returns the created folder with its files.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { connection_id?: string; folder_url?: string; folder_type?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    connection_id: connectionId,
    folder_url:    folderUrl,
    folder_type:   folderType = "general",
  } = body;
  if (!connectionId || !folderUrl) {
    return NextResponse.json({ error: "connection_id and folder_url are required" }, { status: 400 });
  }

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServiceClient();

  // ── Load connection (includes tokens) ──────────────────────────────────────
  const { data: conn, error: connErr } = await supabase
    .from("drive_connections")
    .select("*")
    .eq("id", connectionId)
    .single();

  if (connErr || !conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  // Verify org ownership
  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", conn.org_id)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const connection = conn as DriveConnection;

  try {
    // ── Refresh token if needed ─────────────────────────────────────────────
    let accessToken = connection.access_token;
    if (isTokenExpired(connection.token_expiry)) {
      if (!connection.refresh_token) {
        return NextResponse.json(
          { error: "Drive access has expired. Please reconnect your account." },
          { status: 401 }
        );
      }
      const refreshed =
        connection.provider === "google_drive"
          ? await refreshGoogleToken(connection.refresh_token)
          : await refreshOnedriveToken(connection.refresh_token);
      accessToken = refreshed.access_token;
      await supabase
        .from("drive_connections")
        .update({ access_token: refreshed.access_token, token_expiry: refreshed.expiry, updated_at: new Date().toISOString() })
        .eq("id", connectionId);
    }

    // ── Parse folder URL ────────────────────────────────────────────────────
    let providerFolderId: string;
    let folderName: string;
    let files;

    if (connection.provider === "google_drive") {
      const folderId = parseGoogleFolderUrl(folderUrl);
      if (!folderId) {
        return NextResponse.json(
          { error: "Could not extract folder ID from URL. Make sure it's a Google Drive folder link." },
          { status: 422 }
        );
      }
      providerFolderId = folderId;
      [folderName, files] = await Promise.all([
        getGoogleFolderName(accessToken, folderId),
        listGoogleFolderFiles(accessToken, folderId),
      ]);
    } else {
      // OneDrive
      const parsed = parseOnedriveFolderUrl(folderUrl);
      if (!parsed) {
        return NextResponse.json(
          { error: "Could not parse the OneDrive folder URL or path." },
          { status: 422 }
        );
      }
      providerFolderId = parsed.value;
      [folderName, files] = await Promise.all([
        getOnedriveFolderName(accessToken, parsed.value, parsed.type),
        listOnedriveFolderFiles(accessToken, parsed.value, parsed.type),
      ]);
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No CSV or Excel files found in this folder." },
        { status: 422 }
      );
    }

    // ── Upsert drive_folders ────────────────────────────────────────────────
    const { data: folder, error: folderErr } = await supabase
      .from("drive_folders")
      .upsert(
        {
          org_id:             conn.org_id,
          connection_id:      connectionId,
          provider_folder_id: providerFolderId,
          folder_name:        folderName,
          folder_url:         folderUrl,
          folder_type:        folderType,
          last_scan_at:       new Date().toISOString(),
        },
        { onConflict: "connection_id,provider_folder_id" }
      )
      .select()
      .single();

    if (folderErr || !folder) {
      throw new Error(`Failed to save folder: ${folderErr?.message}`);
    }

    // ── Upsert drive_files ──────────────────────────────────────────────────
    const fileRows = files.map((f) => ({
      org_id:           conn.org_id,
      folder_id:        folder.id,
      provider_file_id: f.id,
      file_name:        f.name,
      mime_type:        f.mimeType,
      last_etag:        f.etag,
      last_modified_at: f.modifiedAt,
    }));

    const { error: filesErr } = await supabase
      .from("drive_files")
      .upsert(fileRows, { onConflict: "folder_id,provider_file_id", ignoreDuplicates: false });

    if (filesErr) throw new Error(`Failed to save files: ${filesErr.message}`);

    // ── Auto-confirm any files that match a previously confirmed file ───────
    // Handles the case where a second folder is added that shares files with
    // an already-confirmed folder in the same org, or future re-adds.
    await autoConfirmNewFiles(supabase, folder.id);

    // ── Return folder + files ───────────────────────────────────────────────
    const { data: result } = await supabase
      .from("drive_folders")
      .select("*, drive_files(*)")
      .eq("id", folder.id)
      .single();

    return NextResponse.json(result);
  } catch (err) {
    console.error("[drive/folders POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add folder" },
      { status: 500 }
    );
  }
}
