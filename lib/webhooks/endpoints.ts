import crypto from "crypto";

/** Signing-secret helpers + URL validation for outbound webhook endpoints. */

export const SIGNING_SECRET_PREFIX = "whsec_";

/** A fresh signing secret — shown to the user ONCE, stored encrypted at rest. */
export function generateSigningSecret(): string {
  return `${SIGNING_SECRET_PREFIX}${crypto.randomBytes(32).toString("hex")}`;
}

/**
 * Validate a receiver URL before we ever POST to it (SSRF guard). Requires https and
 * rejects loopback / private / link-local / cloud-metadata hosts. Note: this is a
 * literal-host check — it does NOT resolve DNS, so a hostname that later resolves to a
 * private IP (DNS rebinding) is not caught here. Acceptable for owner/admin-entered
 * URLs; revisit if endpoints are ever exposed to lower-trust roles.
 */
export function validateWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter a valid URL." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "URL must use https://." };
  const host = u.hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    return { ok: false, error: "Internal hostnames are not allowed." };
  }
  // IPv4 literal → block loopback / private / link-local (incl. 169.254.169.254 metadata).
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if (
      a === 0 || a === 10 || a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254) ||
      a >= 224 // multicast / reserved
    ) {
      return { ok: false, error: "Private or loopback IP addresses are not allowed." };
    }
  }
  // IPv6 loopback / unique-local (fc00::/7) / link-local (fe80::/10).
  if (host === "::1" || host === "[::1]" || /^\[?f[cd]/.test(host) || /^\[?fe8/.test(host)) {
    return { ok: false, error: "Private or loopback IP addresses are not allowed." };
  }
  return { ok: true, url: u.toString() };
}

/** Backoff for a failed delivery: 30s, 60s, 2m, … capped at 6h. */
export function nextBackoffMs(attempts: number): number {
  const base = 30_000 * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(base, 6 * 60 * 60 * 1000);
}
