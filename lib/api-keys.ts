import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Org-scoped API keys for the partner Payments Search API. Only the SHA-256 hash
// is stored; the plaintext is returned once at creation.

const KEY_PREFIX = "fos_live_";

export interface GeneratedKey {
  key: string;      // full plaintext — shown once, never stored
  prefix: string;   // short display label, safe to persist
  hash: string;     // sha256 hex of the full key — what we store & look up by
}

export function generateApiKey(): GeneratedKey {
  const raw = crypto.randomBytes(24).toString("hex"); // 48 hex chars of entropy
  const key = `${KEY_PREFIX}${raw}`;
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export interface VerifiedKey {
  id: string;
  org_id: string;
  scopes: string[];
}

/**
 * Resolve an inbound API key to its org + scopes. Returns null when the key is
 * missing, malformed, unknown, or revoked. Best-effort stamps last_used_at.
 */
export async function verifyApiKey(supabase: SupabaseClient, key: string | null): Promise<VerifiedKey | null> {
  if (!key || !key.startsWith("fos_")) return null;
  const { data } = await supabase
    .from("api_keys")
    .select("id, org_id, scopes, revoked_at")
    .eq("key_hash", hashApiKey(key))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  // Fire-and-forget usage stamp (never blocks the request).
  void supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { id: data.id as string, org_id: data.org_id as string, scopes: (data.scopes as string[]) ?? [] };
}

/** Pull the Bearer token out of an Authorization header. */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
