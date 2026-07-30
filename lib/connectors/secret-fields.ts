/**
 * Which connector `config` keys hold a SECRET credential value, plus helpers to
 * redact them. Anything sent to the browser must go through redaction — secrets
 * must never leave the server. (Encryption at rest is handled separately in
 * lib/crypto/secrets.ts; this module is about what the CLIENT may see.)
 *
 * Pure TS (no Node APIs) so it's safe to import from server or client code.
 */

/** Config keys whose value is a secret credential. */
export const SECRET_CONFIG_KEYS = ["key_secret", "secret_key", "client_secret", "salt", "merchant_key", "api_token"] as const;
const SECRET_SET = new Set<string>(SECRET_CONFIG_KEYS);

export function isSecretConfigKey(key: string): boolean {
  return SECRET_SET.has(key);
}

/**
 * True if a value is a redaction placeholder rather than a real secret. The
 * browser only ever receives masked secrets, so on edit we use this to ignore an
 * "unchanged" secret coming back from the client and keep the real stored one.
 */
export function isMaskedSecret(v: unknown): boolean {
  return typeof v === "string" && v.includes("•"); // contains a bullet (•)
}

/**
 * Mask one secret value for display. For mode-prefixed keys (Stripe sk_/rk_/pk_)
 * we keep ONLY the structural live/test prefix so the UI can still show the mode;
 * everything else becomes pure dots. Never reveals any secret entropy.
 */
function maskValue(value: string): string {
  const m = value.match(/^((?:sk|rk|pk)_(?:live|test)_)/);
  if (m) return `${m[1]}••••`;
  return "••••••••";
}

/** Copy of `config` with every secret value replaced by a safe mask. */
export function redactConfig(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(config ?? {}) };
  for (const k of SECRET_CONFIG_KEYS) {
    if (typeof out[k] === "string" && (out[k] as string).length > 0) {
      out[k] = maskValue(out[k] as string);
    }
  }
  return out;
}

/** Redact a connector row's config — use on anything returned to the browser. */
export function redactConnector<T extends { config?: unknown }>(connector: T): T {
  return { ...connector, config: redactConfig(connector.config as Record<string, unknown>) };
}
