import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { invalidateOrg } from "@/lib/cache/org-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bank/unsplit — reverse a split: delete the child parts and restore the
 * original row to its pre-split classification (from metadata._presplit).
 * Body: { transactionId: string } (the split PARENT's id; a child's id is also
 * accepted and resolved to its parent). Admin/finance-gated.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { transactionId?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.transactionId) return NextResponse.json({ error: "transactionId is required" }, { status: 400 });

  const sb = await createServiceClient();

  const { data: row, error } = await sb
    .from("transactions")
    .select("id, is_split_parent, split_parent_id, metadata")
    .eq("id", body.transactionId)
    .eq("org_id", org.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });

  // Accept either the parent or one of its children.
  const parentId = row.is_split_parent ? row.id : row.split_parent_id;
  if (!parentId) return NextResponse.json({ error: "This transaction is not split." }, { status: 400 });

  const { data: parent } = await sb
    .from("transactions").select("id, metadata").eq("id", parentId).eq("org_id", org.id).maybeSingle();
  if (!parent) return NextResponse.json({ error: "Split parent not found" }, { status: 404 });

  // Delete the parts, then restore the parent's pre-split classification.
  const { error: delErr } = await sb.from("transactions").delete().eq("split_parent_id", parentId).eq("org_id", org.id);
  if (delErr) return NextResponse.json({ error: `Failed to remove parts: ${delErr.message}` }, { status: 500 });

  const meta = (parent.metadata ?? {}) as Record<string, unknown>;
  const pre = (meta._presplit ?? {}) as { category?: string | null; pnl_treatment?: string | null; category_source?: string | null };
  const restMeta = { ...meta };
  delete (restMeta as Record<string, unknown>)._presplit;
  const { error: upErr } = await sb
    .from("transactions")
    .update({
      is_split_parent: false,
      category: pre.category ?? null,
      pnl_treatment: (pre.pnl_treatment ?? null) as "expense" | "income" | "excluded" | "uncategorized" | null,
      category_source: (pre.category_source ?? null) as "manual" | "rule" | "ai" | "system" | null,
      metadata: restMeta as never,
    })
    .eq("id", parentId)
    .eq("org_id", org.id);
  if (upErr) return NextResponse.json({ error: `Failed to restore original: ${upErr.message}` }, { status: 500 });

  invalidateOrg(org.id, { immediate: true });
  return NextResponse.json({ ok: true });
}
