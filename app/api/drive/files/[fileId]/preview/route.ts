import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isTokenExpired } from "@/lib/drive/oauth";
import { refreshGoogleToken, downloadGoogleFile } from "@/lib/drive/google";
import { refreshOnedriveToken, downloadOnedriveFile } from "@/lib/drive/onedrive";
import { extractHeadersAndSample } from "@/lib/drive/normalizer";
import { getColumnMapping } from "@/lib/drive/ai-mapper";
import type { DriveConnection, DriveFile } from "@/lib/drive/types";

/**
 * GET /api/drive/files/[fileId]/preview
 *
 * Downloads the first ~20KB of a drive file, extracts headers + 5 sample rows,
 * runs AI + rule-based column mapping, and returns the suggested mapping.
 *
 * This is called when the user opens the "Map Columns" dialog for a file.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
): Promise<NextResponse> {
  const { fileId } = await params;

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServiceClient();

  // ── Load file record ───────────────────────────────────────────────────────
  const { data: file } = await supabase
    .from("drive_files")
    .select("*, drive_folders!inner(connection_id, org_id)")
    .eq("id", fileId)
    .single();

  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const fileRow = file as DriveFile & { drive_folders: { connection_id: string; org_id: string } };

  // Verify org ownership
  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", fileRow.drive_folders.org_id)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── Load drive connection ──────────────────────────────────────────────────
  const { data: conn } = await supabase
    .from("drive_connections")
    .select("*")
    .eq("id", fileRow.drive_folders.connection_id)
    .single();

  if (!conn) return NextResponse.json({ error: "Drive connection not found" }, { status: 404 });

  const connection = conn as DriveConnection;

  try {
    // ── Refresh token if needed ─────────────────────────────────────────────
    let accessToken = connection.access_token;
    if (isTokenExpired(connection.token_expiry)) {
      if (!connection.refresh_token) {
        return NextResponse.json(
          { error: "Drive access expired. Please reconnect." },
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
        .eq("id", connection.id);
    }

    // ── Download file ───────────────────────────────────────────────────────
    const { buffer, effectiveMime } =
      connection.provider === "google_drive"
        ? await downloadGoogleFile(accessToken, fileRow.provider_file_id, fileRow.mime_type ?? "")
        : await downloadOnedriveFile(accessToken, fileRow.provider_file_id, fileRow.file_name);

    // ── Extract headers + sample rows ───────────────────────────────────────
    const { headers, sampleRows } = await extractHeadersAndSample(buffer, effectiveMime);

    if (headers.length === 0) {
      return NextResponse.json({ error: "Could not read column headers from this file." }, { status: 422 });
    }

    // ── AI column mapping ────────────────────────────────────────────────────
    // Use existing mapping as default if already set; otherwise ask AI
    const suggestedMapping = fileRow.column_mapping
      ?? await getColumnMapping(headers, sampleRows);

    return NextResponse.json({
      headers,
      sample_rows: sampleRows,
      suggested_mapping: suggestedMapping,
      existing_mapping:  fileRow.column_mapping,
      mapping_confirmed: fileRow.mapping_confirmed,
    });
  } catch (err) {
    console.error("[drive/files/preview]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to preview file" },
      { status: 500 }
    );
  }
}
