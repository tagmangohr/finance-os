import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";

export interface ResolvedWebhookConnector {
  id: string;
  org_id: string;
  config: Record<string, unknown>; // decrypted
}

/**
 * Resolve the exact connector a tokenized webhook URL (…?c=<token>) belongs to.
 * Returns null when there's no token, no match, or the connector is inactive —
 * callers then fall back to their existing (legacy) matching. Config secrets are
 * decrypted so the caller can read the per-connector webhook secret.
 */
export async function connectorByToken(
  supabase: SupabaseClient,
  type: string,
  token: string | null
): Promise<ResolvedWebhookConnector | null> {
  if (!token) return null;
  // Guard: only well-formed uuid tokens hit the DB.
  if (!/^[0-9a-fA-F-]{16,64}$/.test(token)) return null;
  const { data } = await supabase
    .from("connectors")
    .select("id, org_id, config, status")
    .eq("type", type)
    .eq("webhook_token", token)
    .maybeSingle();
  if (!data || data.status !== "active") return null;
  return {
    id: data.id as string,
    org_id: data.org_id as string,
    config: decryptConfigSecrets((data.config ?? {}) as Record<string, unknown>),
  };
}
