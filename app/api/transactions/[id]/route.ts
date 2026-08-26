import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/transactions/[id] — manually edit an imported transaction's fields.
 *
 * Owner/admin only (same gate as bank categorize). Editable fields:
 * transaction_date, counterparty_name, description, amount, type. Each edited
 * field is recorded in metadata.manual_fields so a subsequent sheet re-sync
 * (merge) PRESERVES the manual value instead of overwriting it from the source.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  const manual: string[] = [];

  if (typeof body.transaction_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.transaction_date)) {
    patch.transaction_date = body.transaction_date; manual.push("transaction_date");
  }
  if ("counterparty_name" in body) {
    const v = body.counterparty_name == null ? null : String(body.counterparty_name).trim() || null;
    patch.counterparty_name = v; manual.push("counterparty_name");
  }
  if ("description" in body) {
    const v = body.description == null ? null : String(body.description).trim() || null;
    patch.description = v; manual.push("description");
  }
  if (body.amount !== undefined && body.amount !== null && Number.isFinite(Number(body.amount))) {
    patch.amount = Math.abs(Number(body.amount)); manual.push("amount");
  }
  if (body.type === "credit" || body.type === "debit") {
    patch.type = body.type; manual.push("type");
  }

  if (manual.length === 0) return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });

  const sb = await createServiceClient();
  const { data: existing } = await sb
    .from("transactions")
    .select("id, org_id, currency, amount_base, metadata")
    .eq("id", id)
    .eq("org_id", org.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Keep INR base amount in step when the amount is edited.
  if (patch.amount !== undefined && (existing.currency === "INR" || existing.amount_base == null)) {
    patch.amount_base = patch.amount;
  }

  // Record which fields are manually owned so merge-sync won't overwrite them.
  const meta = (existing.metadata ?? {}) as Record<string, unknown>;
  const prevManual = Array.isArray(meta.manual_fields) ? (meta.manual_fields as string[]) : [];
  patch.metadata = { ...meta, manual_fields: Array.from(new Set([...prevManual, ...manual])) };

  const { data: updated, error } = await sb
    .from("transactions")
    .update(patch)
    .eq("id", id)
    .eq("org_id", org.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ transaction: updated });
}
