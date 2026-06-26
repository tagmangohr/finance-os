import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";

/**
 * POST /api/admin/deduplicate
 * Body: { org_id: string; secret: string }
 *
 * Removes duplicate transactions that share the same (org_id, external_id).
 * For each duplicate group, keeps the record with the earliest created_at.
 * Also removes duplicate connector instances beyond the first per
 * (org_id, type, config.key_id | config.secret_key).
 *
 * Protected by ADMIN_SECRET env var to prevent misuse.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string; secret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { org_id, secret } = body;

  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json(
      { error: "Admin endpoint is not configured" },
      { status: 503 }
    );
  }

  if (secret !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!org_id) {
    return NextResponse.json({ error: "org_id required" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  // ── 1. Deduplicate transactions ───────────────────────────────────────────
  // Fetch all rows with external_ids, oldest-first
  const allRows: { id: string; external_id: string }[] = [];
  let offset = 0;
  const BATCH = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, external_id")
      .eq("org_id", org_id)
      .not("external_id", "is", null)
      .order("created_at", { ascending: true })
      .range(offset, offset + BATCH - 1);

    if (error) {
      return NextResponse.json({ error: `Fetch failed: ${error.message}` }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < BATCH) break;
    offset += BATCH;
  }

  // Find duplicates — keep first occurrence per external_id
  const seen = new Set<string>();
  const toDelete: string[] = [];

  for (const row of allRows) {
    if (!row.external_id) continue;
    if (seen.has(row.external_id)) {
      toDelete.push(row.id);
    } else {
      seen.add(row.external_id);
    }
  }

  // Delete in batches of 200
  let txDeleted = 0;
  for (let i = 0; i < toDelete.length; i += 200) {
    const batch = toDelete.slice(i, i + 200);
    const { error } = await supabase
      .from("transactions")
      .delete()
      .in("id", batch);
    if (error) {
      return NextResponse.json({
        error: `Delete failed at batch ${i}: ${error.message}`,
        txDeleted,
      }, { status: 500 });
    }
    txDeleted += batch.length;
  }

  // ── 2. Deduplicate connectors ─────────────────────────────────────────────
  // Keep only the oldest connector per (org_id, type, key_id/secret_key).
  // This removes phantom duplicates created by repeated "Connect" clicks.
  const { data: connectors, error: connErr } = await supabase
    .from("connectors")
    .select("id, type, config, created_at")
    .eq("org_id", org_id)
    .order("created_at", { ascending: true });

  if (connErr) {
    return NextResponse.json({
      error: `Connector fetch failed: ${connErr.message}`,
      txDeleted,
    }, { status: 500 });
  }

  const seenConnectors = new Map<string, string>(); // fingerprint → id to keep
  const connToDelete: string[] = [];

  for (const c of connectors ?? []) {
    // Decrypt first — an encrypted secret uses a random IV, so the same key would
    // fingerprint differently every time and dedup would never match.
    const cfg = decryptConfigSecrets((c.config ?? {}) as Record<string, string>);
    // Fingerprint = type + first credential value (key_id, secret_key, or client_id)
    const credValue =
      cfg.key_id ?? cfg.secret_key ?? cfg.client_id ?? cfg.host ?? "";
    const fingerprint = `${c.type}::${credValue}`;

    if (seenConnectors.has(fingerprint)) {
      connToDelete.push(c.id);
    } else {
      seenConnectors.set(fingerprint, c.id);
    }
  }

  let connDeleted = 0;
  if (connToDelete.length > 0) {
    const { error } = await supabase
      .from("connectors")
      .delete()
      .in("id", connToDelete);
    if (!error) connDeleted = connToDelete.length;
  }

  return NextResponse.json({
    message: "Deduplication complete",
    transactions: { scanned: allRows.length, deleted: txDeleted },
    connectors: { deleted: connDeleted },
  });
}
