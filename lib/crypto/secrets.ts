import crypto from "crypto";
import { SECRET_CONFIG_KEYS } from "@/lib/connectors/secret-fields";

/**
 * Application-level encryption for connector credential secrets (AES-256-GCM).
 *
 * Secrets are encrypted at rest in `connectors.config` so that DB access alone
 * (backups, replicas, SQL console, a leaked service-role key) no longer exposes
 * plaintext credentials — an attacker also needs CONNECTOR_ENC_KEY. The key is a
 * base64-encoded 32-byte value held only in the Vercel env (never in the repo).
 *
 * Rollout-safe by design:
 *  • decrypt() passes plaintext through untouched, so rows that aren't encrypted
 *    yet keep working — no flag-day, migration can run gradually.
 *  • encrypt() is a no-op when no key is configured, so deploying this code
 *    before the key exists never breaks writes (they stay plaintext until the
 *    key is set, then new writes encrypt automatically).
 */

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer | null {
  const raw = process.env.CONNECTOR_ENC_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("CONNECTOR_ENC_KEY must be a base64-encoded 32-byte key (generate with: openssl rand -base64 32)");
  }
  return key;
}

export function isEncryptionConfigured(): boolean {
  return !!process.env.CONNECTOR_ENC_KEY;
}

export function isEncrypted(v: unknown): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** Encrypt a plaintext string → "enc:v1:" + base64(iv | tag | ciphertext). */
export function encryptValue(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext; // no key configured → leave as-is (transitional)
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a value produced by encryptValue. Plaintext (non-prefixed) passes through. */
export function decryptValue(value: string): string {
  if (!isEncrypted(value)) return value;
  const key = getKey();
  if (!key) throw new Error("CONNECTOR_ENC_KEY is required to decrypt connector secrets");
  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** Encrypt every secret field in a config (idempotent; skips already-encrypted). */
export function encryptConfigSecrets<T extends Record<string, unknown>>(config: T): T {
  if (!isEncryptionConfigured()) return config; // no-op until the key is provisioned
  const out = { ...config } as Record<string, unknown>;
  for (const k of SECRET_CONFIG_KEYS) {
    const v = out[k];
    if (typeof v === "string" && v.length > 0 && !isEncrypted(v)) out[k] = encryptValue(v);
  }
  return out as T;
}

/** Decrypt every encrypted secret field in a config (plaintext fields untouched). */
export function decryptConfigSecrets<T extends Record<string, unknown>>(config: T): T {
  const out = { ...config } as Record<string, unknown>;
  for (const k of SECRET_CONFIG_KEYS) {
    const v = out[k];
    if (isEncrypted(v)) out[k] = decryptValue(v as string);
  }
  return out as T;
}
