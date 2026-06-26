/**
 * One-time migration: encrypt existing plaintext connector secrets at rest.
 *
 * Prerequisite: CONNECTOR_ENC_KEY (base64 32 bytes) must be set in .env.local AND
 * in Vercel env — the SAME value in both, or production can't decrypt what this
 * encrypts. Generate once with:  openssl rand -base64 32
 *
 * Idempotent + safe to re-run: already-encrypted ("enc:v1:") values are skipped.
 * Uses the exact format of lib/crypto/secrets.ts (AES-256-GCM, iv|tag|ct).
 *
 * Run:  node scripts/encrypt-connector-secrets.mjs
 */
import { readFileSync } from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const SECRET_CONFIG_KEYS = ["key_secret", "secret_key", "client_secret", "salt", "merchant_key"];
const PREFIX = "enc:v1:";
const env = readFileSync(".env.local", "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");

const rawKey = get("CONNECTOR_ENC_KEY");
if (!rawKey) { console.error("CONNECTOR_ENC_KEY is not set in .env.local — aborting."); process.exit(1); }
const key = Buffer.from(rawKey, "base64");
if (key.length !== 32) { console.error("CONNECTOR_ENC_KEY must be base64 32 bytes (openssl rand -base64 32)."); process.exit(1); }

function encryptValue(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

const sb = createClient(
  get("NEXT_PUBLIC_SUPABASE_URL"),
  get("SUPABASE_SERVICE_ROLE_KEY") || get("SUPABASE_SERVICE_ROLE") || get("SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } }
);

const { data: connectors, error } = await sb.from("connectors").select("id, type, config");
if (error) { console.error(error); process.exit(1); }

let changed = 0, alreadyDone = 0, noSecrets = 0;
for (const c of connectors ?? []) {
  const cfg = { ...(c.config ?? {}) };
  let touched = false, hadSecret = false;
  for (const k of SECRET_CONFIG_KEYS) {
    const v = cfg[k];
    if (typeof v === "string" && v.length > 0) {
      hadSecret = true;
      if (!v.startsWith(PREFIX)) { cfg[k] = encryptValue(v); touched = true; }
    }
  }
  if (touched) {
    const { error: upErr } = await sb.from("connectors").update({ config: cfg }).eq("id", c.id);
    if (upErr) { console.error(`  ${c.type} ${c.id}: update failed — ${upErr.message}`); continue; }
    changed++;
    console.log(`  encrypted ${c.type} (${c.id})`);
  } else if (hadSecret) {
    alreadyDone++;
  } else {
    noSecrets++;
  }
}
console.log(`\nDone. encrypted=${changed}, already-encrypted=${alreadyDone}, no-secrets=${noSecrets}, total=${(connectors ?? []).length}`);
