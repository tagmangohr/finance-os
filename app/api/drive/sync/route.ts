import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { syncDriveFile } from "@/lib/drive/sync";
import type { DriveConnection, DriveFile } from "@/lib/drive/types";

/**
 * POST /api/drive/sync
 *
 * Body: { file_id: string }
 *
 * Syncs a single drive file: downloads it, applies the column mapping,
 * and upserts the transactions.  Mapping must be confirmed first.
 *
 * Returns: { inserted, updated, skipped, fetched }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { file_id?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { file_id: fileId } = body;
  if (!fileId) return NextResponse.json({ error: "file_id is required" }, { status: 400 });

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServiceClient();

  // ── Load file + folder + connection in one join ────────────────────────────
  const { data: fileData } = await supabase
    .from("drive_files")
    .select("*, drive_folders!inner(*, drive_connections!inner(*))")
    .eq("id", fileId)
    .single();

  if (!fileData) return NextResponse.json({ error: "File not found" }, { status: 404 });

  // Type the joined result
  type FileWithJoins = DriveFile & {
    drive_folders: { org_id: string; drive_connections: DriveConnection };
  };
  const file = fileData as FileWithJoins;
  const connection = file.drive_folders.drive_connections;
  const orgId      = file.drive_folders.org_id;

  // Verify org ownership
  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!file.mapping_confirmed) {
    return NextResponse.json(
      { error: "Column mapping has not been confirmed for this file." },
      { status: 422 }
    );
  }

  try {
    const result = await syncDriveFile({ supabase, connection, file });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[drive/sync POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
