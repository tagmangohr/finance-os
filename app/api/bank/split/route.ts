import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getCategories, treatmentMap } from "@/lib/expenses/categories";
import { invalidateOrg } from "@/lib/cache/org-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round(n * 100) / 100;

type PartInput = { amount: number; category: string };

/**
 * POST /api/bank/split — split ONE bank transaction into N parts, each with its own
 * category, summing EXACTLY to the original. The original becomes a hidden "split
 * parent" (excluded from P&L); each part is inserted as a real child bank row that
 * flows through the normal rollups/categorizer. Admin/finance-gated.
 * Body: { transactionId: string, parts: [{ amount: number, category: string }] }
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { transactionId?: string; parts?: PartInput[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { transactionId, parts } = body;
  if (!transactionId || !Array.isArray(parts)) {
    return NextResponse.json({ error: "transactionId and parts[] are required" }, { status: 400 });
  }
  if (parts.length < 2 || parts.length > 10) {
    return NextResponse.json({ error: "Provide between 2 and 10 parts." }, { status: 400 });
  }

  const sb = await createServiceClient();

  // Load the parent — must be a bank row that isn't already split and isn't a child.
  const { data: parent, error: pErr } = await sb
    .from("transactions")
    .select("id, org_id, connector_id, external_id, type, amount, amount_base, currency, base_currency, fx_rate, counterparty_id, counterparty_name, description, source, status, ledger, account_type, transaction_date, transaction_at, category, pnl_treatment, category_source, is_split_parent, split_parent_id, metadata")
    .eq("id", transactionId)
    .eq("org_id", org.id)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!parent) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  if (parent.ledger !== "bank") return NextResponse.json({ error: "Only bank transactions can be split." }, { status: 400 });
  if (parent.is_split_parent) return NextResponse.json({ error: "This transaction is already split. Unsplit it first." }, { status: 400 });
  if (parent.split_parent_id) return NextResponse.json({ error: "A split part cannot itself be split." }, { status: 400 });

  // Validate categories + amounts.
  const cats = await getCategories(org.id, sb);
  const tMap = treatmentMap(cats);
  const validSlugs = new Set(cats.map((c) => c.slug));
  for (const p of parts) {
    if (typeof p.amount !== "number" || !Number.isFinite(p.amount) || p.amount <= 0) {
      return NextResponse.json({ error: "Every part needs a positive amount." }, { status: 400 });
    }
    if (typeof p.category !== "string" || !validSlugs.has(p.category)) {
      return NextResponse.json({ error: `Unknown category: ${p.category}` }, { status: 400 });
    }
  }
  const partsSum = round2(parts.reduce((s, p) => s + p.amount, 0));
  const original = round2(Number(parent.amount));
  if (partsSum !== original) {
    return NextResponse.json(
      { error: `Parts must total exactly ${original} ${parent.currency} (got ${partsSum}).` },
      { status: 400 }
    );
  }

  // Proportional INR base per part; the last part absorbs rounding so the children's
  // amount_base sums to the parent's exactly.
  const totalBase = Number(parent.amount_base ?? parent.amount);
  const baseParts: number[] = [];
  let baseRunning = 0;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) baseParts.push(round2(totalBase - baseRunning));
    else { const b = round2((p.amount / original) * totalBase); baseParts.push(b); baseRunning += b; }
  });

  const meta = (parent.metadata ?? {}) as Record<string, unknown>;
  const childRows = parts.map((p, i) => ({
    org_id: org.id,
    connector_id: parent.connector_id,
    external_id: parent.external_id ? `${parent.external_id}__split_${i + 1}` : `split_${parent.id}_${i + 1}`,
    type: parent.type,
    amount: round2(p.amount),
    amount_base: baseParts[i],
    base_currency: parent.base_currency ?? "INR",
    fx_rate: parent.fx_rate,
    currency: parent.currency,
    category: p.category,
    category_confidence: null,
    counterparty_id: parent.counterparty_id,
    counterparty_name: parent.counterparty_name,
    description: parent.description ? `${parent.description} (split ${i + 1}/${parts.length})` : `Split ${i + 1}/${parts.length}`,
    source: parent.source,
    status: parent.status,
    ledger: "bank" as const,
    pnl_treatment: (tMap.get(p.category) ?? "uncategorized") as "expense" | "income" | "excluded" | "uncategorized",
    category_source: "manual" as const,
    account_type: parent.account_type,
    transaction_date: parent.transaction_date,
    transaction_at: parent.transaction_at,
    split_parent_id: parent.id,
    metadata: { split_of: parent.id, split_index: i + 1, split_count: parts.length },
  }));

  const { error: insErr } = await sb.from("transactions").insert(childRows);
  if (insErr) return NextResponse.json({ error: `Failed to create parts: ${insErr.message}` }, { status: 500 });

  // Neutralize the parent: excluded from all rollups + flagged/hidden. Stash its
  // pre-split classification so Unsplit can restore it cleanly.
  const { error: upErr } = await sb
    .from("transactions")
    .update({
      is_split_parent: true,
      pnl_treatment: "excluded",
      category_source: "system",
      metadata: { ...meta, _presplit: { category: parent.category, pnl_treatment: parent.pnl_treatment, category_source: parent.category_source } },
    })
    .eq("id", parent.id)
    .eq("org_id", org.id);
  if (upErr) {
    // Roll back the children so we never leave a half-split row.
    await sb.from("transactions").delete().eq("split_parent_id", parent.id).eq("org_id", org.id);
    return NextResponse.json({ error: `Failed to mark parent: ${upErr.message}` }, { status: 500 });
  }

  invalidateOrg(org.id, { immediate: true });
  return NextResponse.json({ ok: true, parts: childRows.length });
}
