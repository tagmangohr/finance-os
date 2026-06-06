import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/drive/connections?org_id=<orgId>
 *
 * Lists all drive connections for the org, including their folders and files.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const orgId = req.nextUrl.searchParams.get("org_id");
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("drive_connections")
    .select("*, drive_folders(*, drive_files(*))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Scrub tokens from the response — clients don't need them
  const safe = (data ?? []).map(({ access_token: _a, refresh_token: _r, ...rest }) => rest);
  return NextResponse.json(safe);
}

/**
 * DELETE /api/drive/connections?id=<connectionId>
 *
 * Disconnects a drive account. Deletes the connector record (which cascades to
 * transactions, drive_connection, drive_folders, drive_files via FK cascades).
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServiceClient();

  // Verify ownership through drive_connections → org → user
  const { data: conn } = await supabase
    .from("drive_connections")
    .select("connector_id, org_id")
    .eq("id", id)
    .single();

  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", conn.org_id)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Deleting the connector cascades to transactions + drive_connection + folders + files
  const { error } = await supabase
    .from("connectors")
    .delete()
    .eq("id", conn.connector_id)
    .eq("org_id", conn.org_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
