import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { DriveColumnMapping } from "@/lib/drive/types";

/**
 * POST /api/drive/files/[fileId]/mapping
 *
 * Body: { mapping: DriveColumnMapping }
 *
 * Saves the user-confirmed column mapping and marks the file as ready to sync.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
): Promise<NextResponse> {
  const { fileId } = await params;

  let body: { mapping?: DriveColumnMapping };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.mapping || typeof body.mapping !== "object") {
    return NextResponse.json({ error: "mapping object is required" }, { status: 400 });
  }

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServiceClient();

  // ── Load file + verify ownership ───────────────────────────────────────────
  const { data: file } = await supabase
    .from("drive_files")
    .select("id, drive_folders!inner(org_id)")
    .eq("id", fileId)
    .single();

  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const orgId = (file as unknown as { drive_folders: { org_id: string }[] }).drive_folders[0]?.org_id
    ?? (file as unknown as { drive_folders: { org_id: string } }).drive_folders.org_id;

  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── Validate: mapping must specify at least a date + some amount field ─────
  const m = body.mapping;
  const hasDate   = !!m.date;
  const hasAmount = !!(m.amount || m.debit || m.credit);

  if (!hasDate || !hasAmount) {
    return NextResponse.json(
      { error: "Mapping must include at least a date column and an amount (or debit/credit) column." },
      { status: 422 }
    );
  }

  // ── Save mapping ───────────────────────────────────────────────────────────
  const { data: updated, error } = await supabase
    .from("drive_files")
    .update({ column_mapping: body.mapping, mapping_confirmed: true })
    .eq("id", fileId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(updated);
}

/**
 * DELETE /api/drive/files/[fileId]/mapping
 *
 * Resets the mapping so the user can re-configure it.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
): Promise<NextResponse> {
  const { fileId } = await params;

  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServiceClient();

  const { data: file } = await supabase
    .from("drive_files")
    .select("id, drive_folders!inner(org_id)")
    .eq("id", fileId)
    .single();

  if (!file) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const orgId = (file as unknown as { drive_folders: { org_id: string }[] }).drive_folders[0]?.org_id
    ?? (file as unknown as { drive_folders: { org_id: string } }).drive_folders.org_id;
  const { data: org } = await authClient
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .eq("owner_id", user.id)
    .single();

  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: updated, error } = await supabase
    .from("drive_files")
    .update({ column_mapping: null, mapping_confirmed: false })
    .eq("id", fileId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(updated);
}
