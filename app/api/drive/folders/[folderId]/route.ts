import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * DELETE /api/drive/folders/[folderId]
 *
 * Removes a tracked folder and all its files.
 * Transactions imported from those files are NOT deleted (they belong to the org).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
): Promise<NextResponse> {
  const { folderId } = await params;

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServiceClient();

  // Verify ownership
  const { data: folder } = await supabase
    .from("drive_folders")
    .select("org_id")
    .eq("id", folderId)
    .single();

  if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });

  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", folder.org_id)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { error } = await supabase
    .from("drive_folders")
    .delete()
    .eq("id", folderId)
    .eq("org_id", folder.org_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
