// Aggregate count top-up for an App Store date window: books (report units −
// existing units) per (country × sku × status), so the relay's already-present
// rows aren't duplicated (the report has no txn id → dedup by COUNT, not join).
// Closes the Jul 29–Aug 01 relay-startup seam, and is the same engine used for
// per-closed-month reconciliation. Idempotent (re-run books nothing).
//
// Usage:  node scripts/topup-app-store-window.mjs [--from 2026-07-29] [--to 2026-08-02] [--commit]
//         Window is [from, to) on transaction_date. Dry-run unless --commit.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ALPHA2_TO_ALPHA3, buildFx } from "./_app-store-fx.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const COMMIT = process.argv.includes("--commit");
const FROM = arg("--from", "2026-07-29");
const TO = arg("--to", "2026-08-02");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  const { data: conns } = await sb.from("connectors").select("id, org_id").eq("type", "app_store").eq("status", "active");
  if (!conns?.length) throw new Error("No active app_store connector");
  if (conns.length > 1) throw new Error("Multiple app_store connectors");
  const { id: connectorId, org_id: orgId } = conns[0];
  console.log(`Window [${FROM}, ${TO})  ·  connector ${connectorId}`);

  // Report lines in the window (by effective date).
  const lines = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("app_store_financial_lines")
      .select("transaction_date, settlement_date, sku, apple_identifier, country, quantity, partner_share, customer_price, customer_currency, sale_or_return")
      .eq("org_id", orgId).range(from, from + 999);
    if (error) throw new Error(error.message);
    lines.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const eff = (l) => l.transaction_date || l.settlement_date;
  const inWin = (d) => d && d >= FROM && d < TO;
  const win = lines.filter((l) => l.sku && l.country && inWin(eff(l)) && l.customer_price !== 0);

  // Target counts + unit pools per (country × sku).
  const grp = new Map(); // key -> { sales:[], returns:[] }
  for (const l of win) {
    const key = `${l.country}::${l.sku}`;
    if (!grp.has(key)) grp.set(key, { sales: [], returns: [] });
    const g = grp.get(key);
    const q = Math.abs(l.quantity) || 1;
    for (let i = 0; i < q; i++) {
      const u = { date: eff(l), cp: Math.abs(l.customer_price), ps: Math.abs(l.partner_share), cur: l.customer_currency, country: l.country, sku: l.sku, apple_id: l.apple_identifier };
      (l.sale_or_return === "R" ? g.returns : g.sales).push(u);
    }
  }

  // Existing app_store txns already in the window, per key × status.
  const existing = new Map(); // key -> {completed, refunded}
  const txns = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("transactions")
      .select("transaction_date, status, metadata").eq("org_id", orgId).eq("source", "app_store")
      .gte("transaction_date", FROM).lt("transaction_date", TO).range(from, from + 999);
    if (error) throw new Error(error.message);
    txns.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const a2FromA3 = Object.fromEntries(Object.entries(ALPHA2_TO_ALPHA3).map(([a2, a3]) => [a3, a2]));
  for (const t of txns) {
    const a3 = t.metadata?.storefront, sku = t.metadata?.product_id;
    const a2 = a2FromA3[a3] ?? a3;
    const key = `${a2}::${sku}`;
    if (!existing.has(key)) existing.set(key, { completed: 0, refunded: 0 });
    const e = existing.get(key);
    if (t.status === "refunded") e.refunded++; else e.completed++;
  }

  // Compute shortfall unit rows.
  const currencies = [...new Set(win.map((l) => l.customer_currency).filter(Boolean))];
  const dates = win.map(eff).sort();
  const fx = dates.length ? await buildFx(currencies, dates[0], dates[dates.length - 1]) : { rateFor: () => null, missing: new Set() };

  const rows = [];
  const seq = new Map();
  const nextSeq = (k) => { const n = seq.get(k) ?? 0; seq.set(k, n + 1); return n; };
  let needC = 0, needR = 0;
  for (const [key, g] of grp) {
    g.sales.sort((a, b) => a.date.localeCompare(b.date));
    const targetC = Math.max(0, g.sales.length - g.returns.length);
    const targetR = g.returns.length;
    const ex = existing.get(key) ?? { completed: 0, refunded: 0 };
    const bookC = Math.max(0, targetC - ex.completed);
    const bookR = Math.max(0, targetR - ex.refunded);
    needC += bookC; needR += bookR;
    const build = (u, status) => {
      const a3 = ALPHA2_TO_ALPHA3[u.country] ?? u.country;
      const rate = fx.rateFor(u.cur, u.date);
      const amount = Number(u.cp.toFixed(2));
      const k = `${status[0]}:${u.country}:${u.sku}:${u.date}`;
      return {
        org_id: orgId, connector_id: connectorId,
        external_id: `appstore_rpt_${status[0].toUpperCase()}_${u.country}_${u.sku}_${u.date}_tu_${nextSeq(k)}`,
        type: "credit", amount, currency: u.cur,
        amount_base: rate != null ? Number((amount * rate).toFixed(2)) : null,
        base_currency: "INR", fx_rate: rate, category: null, counterparty_name: null,
        description: `${status === "refunded" ? "REFUND" : "SALE"} · ${u.sku}`,
        source: "app_store", status, transaction_date: u.date, transaction_at: null,
        metadata: { product_id: u.sku, storefront: a3, country: u.country, quantity: 1, fee: Number((u.cp - u.ps).toFixed(2)), net: Number(u.ps.toFixed(2)), apple_identifier: u.apple_id, synthetic: true, source_report: "app_store_financial" },
      };
    };
    for (let i = 0; i < bookC; i++) rows.push(build(g.sales[i], "completed"));
    for (let i = 0; i < bookR; i++) rows.push(build(g.returns[i], "refunded"));
  }

  console.log(`Report units in window: ${win.reduce((a, l) => a + Math.abs(l.quantity || 1), 0)}  ·  existing txns: ${txns.length}`);
  console.log(`Top-up to book: ${rows.length}  (completed ${needC}, refunded ${needR})`);
  if (fx.missing.size) console.log(`  ⚠ no FX for: ${[...fx.missing].join(", ")}`);
  if (!rows.length) { console.log("Nothing to top up — window already reconciled."); return; }
  if (!COMMIT) { console.log("\nDRY RUN — pass --commit to write."); return; }

  const ids = rows.map((r) => r.external_id);
  const present = new Set();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from("transactions").select("external_id").eq("org_id", orgId).in("external_id", ids.slice(i, i + 300));
    for (const r of data ?? []) present.add(r.external_id);
  }
  const fresh = rows.filter((r) => !present.has(r.external_id));
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await sb.from("transactions").insert(fresh.slice(i, i + 500));
    if (error) throw new Error(`insert: ${error.message}`);
  }
  console.log(`✓ Inserted ${fresh.length} top-up transactions (${present.size} already present).`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
