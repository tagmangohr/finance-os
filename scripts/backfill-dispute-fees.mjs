// Historical dispute (chargeback) FEE backfill.
//
// The gateway's chargeback PENALTY fee (distinct from the disputed principal) was
// never captured. Forward capture now stamps it on new dispute rows:
//   • Stripe   — normalizeStripeDispute reads the net balance-transaction fee.
//   • Cashfree — the nightly reconcile stamps it from the settlement-recon feed.
// This one-off fills the fee onto EXISTING (historical) dispute rows so the P&L
// "Dispute Fees" line is correct for past months too. Fill-only + idempotent
// (never overwrites an existing dispute_fee, never creates a row).
//
// Usage:  node scripts/backfill-dispute-fees.mjs [--commit] [--since=YYYY-MM-DD]
//         Dry-run by default (prints what it WOULD stamp). --commit writes.
//         --since defaults to 2025-04-01 (covers the current + prior FY).

import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const COMMIT = process.argv.includes("--commit");
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const SINCE = sinceArg ? sinceArg.slice("--since=".length) : "2025-04-01";
const SINCE_SEC = Math.floor(new Date(`${SINCE}T00:00:00Z`).getTime() / 1000);

// ── env + Supabase (service role) ─────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── connector-secret decrypt (mirror lib/crypto/secrets.ts, AES-256-GCM) ───────
const ENC_PREFIX = "enc:v1:";
const encKey = env.CONNECTOR_ENC_KEY ? Buffer.from(env.CONNECTOR_ENC_KEY, "base64") : null;
function decryptValue(v) {
  if (typeof v !== "string" || !v.startsWith(ENC_PREFIX)) return v;
  if (!encKey || encKey.length !== 32) throw new Error("CONNECTOR_ENC_KEY (base64 32-byte) required to decrypt secrets");
  const buf = Buffer.from(v.slice(ENC_PREFIX.length), "base64");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", encKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
const decryptConfig = (cfg) => Object.fromEntries(Object.entries(cfg ?? {}).map(([k, v]) => [k, decryptValue(v)]));

const ZERO_DECIMAL = new Set(["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"]);
const round2 = (n) => Number(n.toFixed(2));

// Fill dispute_fee on one row (fill-only). Returns 1 if it would write, else 0.
async function stampRow(row, fee) {
  const m = (row.metadata ?? {});
  if (m.dispute_fee != null) return 0;         // already stamped — skip
  if (!(fee > 0)) return 0;
  if (!COMMIT) return 1;                        // dry-run — count only
  const { error } = await sb.from("transactions")
    .update({ metadata: { ...m, dispute_fee: round2(fee) } })
    .eq("id", row.id);
  if (error) { console.error(`  ! update failed ${row.external_id}: ${error.message}`); return 0; }
  return 1;
}

// ── Stripe ─────────────────────────────────────────────────────────────────────
async function backfillStripe(connector) {
  const cfg = decryptConfig(connector.config);
  if (!cfg.secret_key) { console.log(`  stripe ${connector.id}: no secret_key — skip`); return; }
  const stripe = new Stripe(cfg.secret_key);

  // Map external_id → stored dispute row (only rows lacking a fee).
  const { data: rows } = await sb.from("transactions")
    .select("id, external_id, metadata, currency")
    .eq("org_id", connector.org_id).eq("source", "stripe_dispute");
  const byId = new Map((rows ?? []).map((r) => [r.external_id, r]));

  let seen = 0, feeSeen = 0, wrote = 0, unmatched = 0;
  for await (const d of stripe.disputes.list({ created: { gte: SINCE_SEC }, limit: 100 })) {
    seen++;
    const btxns = d.balance_transactions ?? [];
    let feeMinor = 0, feeCur = (d.currency ?? "usd").toUpperCase();
    for (const bt of btxns) { feeMinor += Number(bt.fee ?? 0) || 0; if (bt.currency) feeCur = bt.currency.toUpperCase(); }
    const row = byId.get(d.id);
    // Only stamp when the fee (settlement) currency matches the row's presentment
    // currency, so the row's fx_rate converts it correctly (same guard as the normalizer).
    const rowCur = (row?.currency ?? d.currency ?? "usd").toUpperCase();
    const fee = feeMinor === 0 || feeCur !== rowCur ? 0 : ZERO_DECIMAL.has(feeCur) ? feeMinor : feeMinor / 100;
    if (fee > 0) feeSeen++;
    if (!row) { if (fee > 0) unmatched++; continue; }
    wrote += await stampRow(row, fee);
  }
  console.log(`  stripe ${connector.id} (org ${connector.org_id}): disputes=${seen} withFee=${feeSeen} ${COMMIT ? "stamped" : "would-stamp"}=${wrote} unmatched(noRow)=${unmatched}`);
}

// ── Cashfree ─────────────────────────────────────────────────────────────────
const CF_BASE = "https://api.cashfree.com/pg";
const DAY = 86_400_000, WIN = 10 * DAY;

async function cashfreeReconDisputeFees(cfg, fromDate, toDate) {
  const headers = { "x-client-id": cfg.client_id, "x-client-secret": cfg.client_secret, "x-api-version": "2025-01-01", "Content-Type": "application/json", Accept: "application/json" };
  const out = [];
  const end = toDate.getTime();
  const start = Math.round(fromDate.getTime() / DAY) * DAY;
  for (let cur = start; cur < end; cur += WIN) {
    const from = new Date(cur), to = new Date(Math.min(cur + WIN, end));
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        let cursor = null;
        do {
          const res = await fetch(`${CF_BASE}/settlement/recon`, { method: "POST", headers, body: JSON.stringify({ pagination: { limit: 1000, cursor }, filters: { start_date: from.toISOString(), end_date: to.toISOString() } }) });
          if (!res.ok) throw new Error(`recon ${res.status}: ${(await res.text()).slice(0, 120)}`);
          const data = await res.json();
          for (const ev of data.data ?? []) {
            const type = (ev.event_details?.event_type ?? "").toUpperCase();
            if (!(type.includes("DISPUTE") || type.includes("CHARGEBACK") || type === "PRE_ARBITRATION")) continue;
            const fee = Number(ev.event_details?.event_service_charge ?? 0) + Number(ev.event_details?.event_service_tax ?? 0);
            if (!Number.isFinite(fee) || fee === 0) continue;
            out.push({ orderId: ev.order_details?.order_id ?? null, cfPaymentId: ev.payment_details?.cf_payment_id != null ? String(ev.payment_details.cf_payment_id) : null, fee });
          }
          cursor = data.cursor ?? null;
        } while (cursor);
        break; // window done
      } catch (e) {
        if (attempt < 5) { await new Promise((r) => setTimeout(r, 800 * attempt)); continue; }
        console.error(`  ! cashfree recon window ${from.toISOString().slice(0,10)}..${to.toISOString().slice(0,10)} gave up: ${e.message}`);
      }
    }
  }
  return out;
}

async function backfillCashfree(connector) {
  const cfg = decryptConfig(connector.config);
  if (!cfg.client_id || !cfg.client_secret) { console.log(`  cashfree ${connector.id}: no creds — skip`); return; }

  const events = await cashfreeReconDisputeFees(cfg, new Date(`${SINCE}T00:00:00Z`), new Date());
  const byPayment = new Map(), byOrder = new Map();
  for (const e of events) {
    if (e.cfPaymentId) byPayment.set(e.cfPaymentId, (byPayment.get(e.cfPaymentId) ?? 0) + e.fee);
    if (e.orderId) byOrder.set(e.orderId, (byOrder.get(e.orderId) ?? 0) + e.fee);
  }

  const { data: rows } = await sb.from("transactions")
    .select("id, external_id, metadata")
    .eq("org_id", connector.org_id).eq("source", "cashfree_dispute").eq("category", "dispute");
  let wrote = 0, matched = 0;
  for (const r of rows ?? []) {
    const m = r.metadata ?? {};
    const pid = m.cf_payment_id != null ? String(m.cf_payment_id) : null;
    const oid = m.order_id != null ? String(m.order_id) : null;
    const fee = (pid && byPayment.get(pid)) || (oid && byOrder.get(oid)) || 0;
    if (fee > 0) matched++;
    wrote += await stampRow(r, fee);
  }
  console.log(`  cashfree ${connector.id} (org ${connector.org_id}): feeEvents=${events.length} disputeRows=${(rows ?? []).length} matched=${matched} ${COMMIT ? "stamped" : "would-stamp"}=${wrote}`);
}

// ── main ───────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Dispute-fee backfill — ${COMMIT ? "COMMIT (writing)" : "DRY-RUN (no writes)"} — since ${SINCE}\n`);
  const { data: connectors, error } = await sb.from("connectors").select("*").eq("status", "active").in("type", ["stripe", "cashfree"]);
  if (error) { console.error("connectors query failed:", error.message); process.exit(1); }
  for (const c of connectors ?? []) {
    try {
      if (c.type === "stripe") await backfillStripe(c);
      else if (c.type === "cashfree") await backfillCashfree(c);
    } catch (e) { console.error(`  ! ${c.type} ${c.id} failed:`, e.message); }
  }
  console.log(`\nDone.${COMMIT ? "" : "  (dry-run — re-run with --commit to write)"}`);
  process.exit(0);
})();
