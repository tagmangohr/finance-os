import { randomBytes, createHmac } from "crypto";
import type { DriveProvider } from "./types";

// ─── State token (CSRF protection) ────────────────────────────────────────────
// We encode orgId + provider + nonce in the OAuth state param.
// The nonce is signed with OAUTH_STATE_SECRET so it cannot be forged.
// Cookie name: drive_oauth_nonce_{provider}

const STATE_SECRET = process.env.OAUTH_STATE_SECRET ?? "dev-oauth-secret-change-in-prod";
const NONCE_COOKIE = (provider: DriveProvider) => `drive_oauth_nonce_${provider}`;

/** Returns { stateParam, nonceCookie } — stateParam goes into the provider URL,
 *  nonceCookie must be set before the redirect happens. */
export function buildOAuthState(orgId: string, provider: DriveProvider): {
  stateParam: string;
  nonce: string;
} {
  const nonce = randomBytes(16).toString("hex");
  const payload = JSON.stringify({ orgId, provider, nonce });
  const sig = createHmac("sha256", STATE_SECRET).update(payload).digest("hex").slice(0, 16);
  // stateParam = base64url(payload:sig)
  const stateParam = Buffer.from(`${payload}:${sig}`).toString("base64url");
  return { stateParam, nonce };
}

/** Parse and verify the state param returned by the OAuth provider.
 *  Returns null if the state is invalid or tampered. */
export function parseOAuthState(
  stateParam: string,
  expectedNonce: string
): { orgId: string; provider: DriveProvider } | null {
  try {
    const raw = Buffer.from(stateParam, "base64url").toString("utf-8");
    const lastColon = raw.lastIndexOf(":");
    if (lastColon === -1) return null;

    const payload = raw.slice(0, lastColon);
    const sig = raw.slice(lastColon + 1);

    // Verify HMAC signature
    const expectedSig = createHmac("sha256", STATE_SECRET)
      .update(payload)
      .digest("hex")
      .slice(0, 16);
    if (sig !== expectedSig) return null;

    const parsed = JSON.parse(payload) as { orgId: string; provider: DriveProvider; nonce: string };
    if (parsed.nonce !== expectedNonce) return null;
    if (!parsed.orgId || !parsed.provider) return null;

    return { orgId: parsed.orgId, provider: parsed.provider };
  } catch {
    return null;
  }
}

export { NONCE_COOKIE };

// ─── Token expiry helpers ─────────────────────────────────────────────────────

/** Convert an expires_in seconds number to an ISO expiry timestamp. */
export function expiryFromSecondsIn(expiresIn: number): string {
  return new Date(Date.now() + (expiresIn - 60) * 1000).toISOString();
}

/** Returns true if the token expires within the next 5 minutes. */
export function isTokenExpired(tokenExpiry: string | null): boolean {
  if (!tokenExpiry) return true;
  return new Date(tokenExpiry).getTime() < Date.now() + 5 * 60 * 1000;
}

// ─── Public base URL ──────────────────────────────────────────────────────────

export function getBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
}
