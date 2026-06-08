/**
 * Lightweight HMAC-based sync token.
 *
 * Generated server-side at page load and passed to the client as a prop.
 * The sync API route verifies the HMAC locally — zero network calls, zero
 * cold-start overhead — replacing the 3 sequential Supabase round-trips
 * that were pushing sync requests past Vercel's function timeout.
 *
 * Tokens are tied to (connectorId, orgId) and rotate every 30 minutes.
 * Two consecutive windows are accepted so a token stays valid for 30–60 min.
 */
import { createHmac, timingSafeEqual } from "crypto";

const WINDOW_SECONDS = 30 * 60; // 30-minute windows

function currentWindow(): number {
  return Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
}

function sign(connectorId: string, orgId: string, window: number): string {
  return createHmac("sha256", process.env.CRON_SECRET!)
    .update(`${connectorId}:${orgId}:${window}`)
    .digest("hex");
}

/** Call from a server component — requires CRON_SECRET in env. */
export function generateSyncToken(connectorId: string, orgId: string): string {
  const w = currentWindow();
  return `${w}.${sign(connectorId, orgId, w)}`;
}

/**
 * Verify a sync token without any network calls.
 * Returns true if the token is valid for the given (connectorId, orgId).
 */
export function verifySyncToken(
  token: string,
  connectorId: string,
  orgId: string
): boolean {
  const parts = (token ?? "").split(".");
  if (parts.length !== 2) return false;

  const [wStr, sig] = parts;
  const w = Number(wStr);
  if (!Number.isFinite(w)) return false;

  const current = currentWindow();
  // Accept current and previous window (handles boundary edge-cases)
  if (w !== current && w !== current - 1) return false;

  const expected = sign(connectorId, orgId, w);
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
