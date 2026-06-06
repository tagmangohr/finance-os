import type { createServiceClient } from "@/lib/supabase/server";
import { isTokenExpired } from "./oauth";
import { refreshGoogleToken, downloadGoogleFile } from "./google";
import { refreshOnedriveToken, downloadOnedriveFile } from "./onedrive";
import { parseFileToRows, normalizeDriverRows } from "./normalizer";
import { getExistingTransactionsByExternalId } from "@/lib/db/dedup";
import type { DriveFile, DriveConnection, DriveColumnMapping } from "./types";
import type { Database } from "@/lib/supabase/types";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;
type TransactionInsert = Database["public"]["Tables"]["transactions"]["Insert"];
type TransactionUpdate = Database["public"]["Tables"]["transactions"]["Update"];

// ─── Token management ─────────────────────────────────────────────────────────

/** Returns a fresh access token for the connection, refreshing if necessary. */
async function getFreshAccessToken(
  supabase: ServiceClient,
  conn: DriveConnection
): Promise<string> {
  if (!isTokenExpired(conn.token_expiry)) {
    return conn.access_token;
  }

  if (!conn.refresh_token) {
    throw new Error("Drive connection has no refresh token — user must reconnect");
  }

  const refreshed =
    conn.provider === "google_drive"
      ? await refreshGoogleToken(conn.refresh_token)
      : await refreshOnedriveToken(conn.refresh_token);

  // Persist the new access token
  await supabase
    .from("drive_connections")
    .update({
      access_token: refreshed.access_token,
      token_expiry: refreshed.expiry,
      updated_at:   new Date().toISOString(),
    })
    .eq("id", conn.id);

  return refreshed.access_token;
}

// ─── Sync result ──────────────────────────────────────────────────────────────

export type DriveSyncResult = {
  fetched:  number;
  inserted: number;
  updated:  number;
  skipped:  number;
};

// ─── Main sync function ───────────────────────────────────────────────────────

/** Fetches the file from the cloud, parses it, applies the column mapping,
 *  and upserts resulting transactions into the `transactions` table.
 *  Returns a summary of what happened. */
export async function syncDriveFile({
  supabase,
  connection,
  file,
}: {
  supabase: ServiceClient;
  connection: DriveConnection;
  file: DriveFile;
}): Promise<DriveSyncResult> {
  if (!file.mapping_confirmed || !file.column_mapping) {
    throw new Error("Cannot sync file — column mapping has not been confirmed yet");
  }

  const mapping: DriveColumnMapping = file.column_mapping;
  const accessToken = await getFreshAccessToken(supabase, connection);

  // ── Download the file ────────────────────────────────────────────────────
  const { buffer, effectiveMime } =
    connection.provider === "google_drive"
      ? await downloadGoogleFile(accessToken, file.provider_file_id, file.mime_type ?? "")
      : await downloadOnedriveFile(accessToken, file.provider_file_id, file.file_name);

  // ── Parse into rows ──────────────────────────────────────────────────────
  const rows = await parseFileToRows(buffer, effectiveMime);

  // ── Normalise ────────────────────────────────────────────────────────────
  const transactions = normalizeDriverRows(rows, mapping, file.provider_file_id);

  const result: DriveSyncResult = {
    fetched:  transactions.length,
    inserted: 0,
    updated:  0,
    skipped:  0,
  };

  if (transactions.length === 0) {
    await markFileSynced(supabase, file.id, rows.length);
    return result;
  }

  // ── Build insert rows ────────────────────────────────────────────────────
  const insertRows: TransactionInsert[] = transactions.map((tx) => ({
    org_id:            connection.org_id,
    connector_id:      connection.connector_id,
    external_id:       tx.external_id,
    type:              tx.type,
    amount:            tx.amount,
    currency:          tx.currency,
    category:          tx.category,
    category_confidence: null,
    counterparty_id:   null,
    counterparty_name: tx.counterparty_name,
    description:       tx.description,
    source:            connection.provider === "google_drive" ? "google_drive" : "onedrive",
    status:            tx.status,
    transaction_date:  tx.transaction_date,
    metadata:          tx.metadata as import("@/lib/supabase/types").Json,
  }));

  // ── Dedup against existing rows ──────────────────────────────────────────
  const externalIds = insertRows
    .map((r) => r.external_id)
    .filter(Boolean) as string[];

  const existingByExternalId = externalIds.length
    ? await getExistingTransactionsByExternalId(supabase, connection.org_id, externalIds)
    : new Map();

  const newRows      = insertRows.filter((r) => !r.external_id || !existingByExternalId.has(r.external_id));
  const existingRows = insertRows.filter((r) => r.external_id  && existingByExternalId.has(r.external_id));

  // ── Insert new ───────────────────────────────────────────────────────────
  if (newRows.length > 0) {
    const { error, count } = await supabase
      .from("transactions")
      .insert(newRows, { count: "exact" });

    if (error) throw new Error(`Drive sync insert failed: ${error.message}`);
    result.inserted = count ?? newRows.length;
  }

  // ── Update changed existing rows ─────────────────────────────────────────
  for (const row of existingRows) {
    if (!row.external_id) continue;
    const existing = existingByExternalId.get(row.external_id) ?? [];
    const refreshFields = toRefreshFields(row);
    const changed = existing.filter((e: Parameters<typeof hasChanged>[0]) => hasChanged(e, refreshFields));

    if (changed.length === 0) { result.skipped++; continue; }

    for (const e of changed) {
      const { error } = await supabase
        .from("transactions")
        .update(refreshFields)
        .eq("id", e.id)
        .eq("org_id", connection.org_id);

      if (error) throw new Error(`Drive sync update failed for ${row.external_id}: ${error.message}`);
    }
    result.updated++;
  }

  // ── Mark file synced ─────────────────────────────────────────────────────
  await markFileSynced(supabase, file.id, rows.length);

  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function markFileSynced(supabase: ServiceClient, fileId: string, rowCount: number) {
  await supabase
    .from("drive_files")
    .update({ last_sync_at: new Date().toISOString(), row_count: rowCount })
    .eq("id", fileId);
}

function toRefreshFields(row: TransactionInsert): TransactionUpdate {
  return {
    type:              row.type,
    amount:            row.amount,
    currency:          row.currency,
    category:          row.category,
    counterparty_name: row.counterparty_name,
    description:       row.description,
    source:            row.source,
    status:            row.status,
    transaction_date:  row.transaction_date,
    metadata:          row.metadata,
  };
}

function stableJson(v: unknown) { return JSON.stringify(v ?? null); }

function hasChanged(
  existing: { type: string; amount: unknown; currency: string; category: string | null; counterparty_name: string | null; description: string | null; source: string; status: string; transaction_date: string; metadata: unknown },
  next: TransactionUpdate
): boolean {
  return (
    existing.type              !== next.type              ||
    Number(existing.amount)    !== Number(next.amount)    ||
    existing.currency          !== next.currency          ||
    existing.category          !== next.category          ||
    existing.counterparty_name !== next.counterparty_name ||
    existing.description       !== next.description       ||
    existing.source            !== next.source            ||
    existing.status            !== next.status            ||
    existing.transaction_date  !== next.transaction_date  ||
    stableJson(existing.metadata) !== stableJson(next.metadata)
  );
}
