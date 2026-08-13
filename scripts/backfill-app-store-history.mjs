// Historical App Store revenue backfill (pre-relay).
// The App Store connector was created 2026-07-29 and notifications are forward-only,
// so Dec 2025 → Jul 28 2026 has ZERO relay transactions. The financial reports are
// the only record. This books those months as transactions (one row per unit), with
// exact per-unit fee = customer_price − partner_share from the report, FX-converted
// to INR. Cutoff 2026-07-29 = the relay start → zero overlap → no double-count.
//
// Returns (R lines) are netted: completed = (S_units − R_units) per (country × sku),
// plus R_units refunded rows — so gross / refunds / net all stay correct (mirrors the
// relay + Stripe refund model). Idempotent via deterministic external_id + dedup.
//
// Usage:  node scripts/backfill-app-store-history.mjs [--commit]
//         (dry-run by default; prints what it WOULD insert. Pass --commit to write.)

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const COMMIT = process.argv.includes("--commit");
const RELAY_START = "2026-07-29"; // exclusive upper bound for the backfill

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ALPHA2_TO_ALPHA3 = { AE:"ARE",AU:"AUS",AT:"AUT",BE:"BEL",BH:"BHR",BR:"BRA",CA:"CAN",CH:"CHE",CL:"CHL",CN:"CHN",CO:"COL",CY:"CYP",CZ:"CZE",DE:"DEU",DK:"DNK",EG:"EGY",ES:"ESP",FI:"FIN",FJ:"FJI",FR:"FRA",GB:"GBR",GR:"GRC",HK:"HKG",HR:"HRV",HU:"HUN",ID:"IDN",IE:"IRL",IL:"ISR",IN:"IND",IS:"ISL",IT:"ITA",JP:"JPN",KR:"KOR",KW:"KWT",LK:"LKA",LU:"LUX",MV:"MDV",MX:"MEX",MY:"MYS",MZ:"MOZ",NG:"NGA",NL:"NLD",NO:"NOR",NP:"NPL",NZ:"NZL",OM:"OMN",PH:"PHL",PK:"PAK",PL:"POL",PT:"PRT",QA:"QAT",RO:"ROU",RU:"RUS",SA:"SAU",SE:"SWE",SG:"SGP",TH:"THA",TR:"TUR",TW:"TWN",TZ:"TZA",UA:"UKR",US:"USA",VN:"VNM",ZA:"ZAF" };

// ── FX to INR ────────────────────────────────────────────────────────────────
// frankfurter (ECB) covers the majors; Gulf currencies are USD-pegged; a few
// exotics use a static approximate INR rate (tiny volume — disclosed in output).
const FRANKFURTER = new Set(["AUD","BGN","BRL","CAD","CHF","CNY","CZK","DKK","EUR","GBP","HKD","HUF","IDR","ILS","ISK","JPY","KRW","MXN","MYR","NOK","NZD","PHP","PLN","RON","SEK","SGD","THB","TRY","USD","ZAR"]);
const USD_PEG = { AED: 0.272294, SAR: 0.266667, QAR: 0.274725, OMR: 2.600780, BHD: 2.659574, KWD: 3.25 }; // USD per 1 unit
const STATIC_INR = { PKR: 0.30, TZS: 0.033, MZN: 1.35, NPR: 0.625, MVR: 5.42, LKR: 0.28, EGP: 1.75, RUB: 0.95, TWD: 2.65, VND: 0.0034, NGN: 0.057 };
const FX_BASE = "https://api.frankfurter.dev/v1";

const minusDays = (iso, d) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10); };

async function fetchRange(cur, from, to) {
  const url = `${FX_BASE}/${from}..${to}?from=${cur}&to=INR`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`FX ${cur} ${res.status}`);
  const j = await res.json();
  const m = new Map();
  for (const [d, o] of Object.entries(j.rates ?? {})) if (typeof o?.INR === "number") m.set(d, o.INR);
  return m;
}
const nearestPrior = (map, date) => {
  if (map.has(date)) return map.get(date);
  let best = null;
  for (const [d, r] of map) if (d <= date && (best === null || d > best[0])) best = [d, r];
  return best ? best[1] : null;
};

async function main() {
  const { data: conns } = await sb.from("connectors").select("id, org_id, status").eq("type", "app_store").eq("status", "active");
  if (!conns?.length) throw new Error("No active app_store connector");
  if (conns.length > 1) throw new Error("Multiple app_store connectors");
  const { id: connectorId, org_id: orgId } = conns[0];

  // Pull pre-cutoff report lines.
  const lines = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("app_store_financial_lines")
      .select("transaction_date, settlement_date, sku, apple_identifier, country, quantity, partner_share, customer_price, customer_currency, sale_or_return, report_period")
      .eq("org_id", orgId).range(from, from + 999);
    if (error) throw new Error(error.message);
    lines.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const eff = (l) => l.transaction_date || l.settlement_date;
  const pre = lines.filter((l) => l.sku && l.country && eff(l) && eff(l) < RELAY_START && l.customer_price !== 0);
  console.log(`Lines: ${lines.length} total · ${pre.length} pre-${RELAY_START}`);

  // Build FX maps.
  const dates = pre.map(eff).sort();
  const minD = minusDays(dates[0], 10), maxD = dates[dates.length - 1];
  const currencies = [...new Set(pre.map((l) => l.customer_currency).filter(Boolean))];
  const fxMaps = new Map();
  let usdMap = null;
  const needUsd = currencies.some((c) => USD_PEG[c]);
  if (needUsd || currencies.includes("USD")) usdMap = await fetchRange("USD", minD, maxD);
  for (const c of currencies) {
    if (c === "INR") continue;
    if (c === "USD") { fxMaps.set(c, usdMap); continue; }
    if (FRANKFURTER.has(c)) { try { fxMaps.set(c, await fetchRange(c, minD, maxD)); } catch (e) { console.warn(`  FX fail ${c}: ${e.message}`); } }
  }
  const rateFor = (cur, date) => {
    if (cur === "INR") return 1;
    if (fxMaps.has(cur)) { const r = nearestPrior(fxMaps.get(cur), date); if (r != null) return r; }
    if (USD_PEG[cur] && usdMap) { const u = nearestPrior(usdMap, date); if (u != null) return USD_PEG[cur] * u; }
    if (STATIC_INR[cur]) return STATIC_INR[cur];
    return null;
  };

  // ── Expand to unit rows, netting returns per (country × sku) ──
  const bySku = new Map(); // key -> { sales:[], returns:[] }
  for (const l of pre) {
    const key = `${l.country}::${l.sku}`;
    if (!bySku.has(key)) bySku.set(key, { sales: [], returns: [] });
    const g = bySku.get(key);
    const q = Math.abs(l.quantity) || 1;
    for (let i = 0; i < q; i++) {
      const unit = { date: eff(l), cp: Math.abs(l.customer_price), ps: Math.abs(l.partner_share), cur: l.customer_currency, country: l.country, sku: l.sku, apple_id: l.apple_identifier };
      if (l.sale_or_return === "R") g.returns.push(unit); else g.sales.push(unit);
    }
  }

  const rows = [];
  const seq = new Map();
  const nextSeq = (k) => { const n = (seq.get(k) ?? 0); seq.set(k, n + 1); return n; };
  const noFx = new Set();
  let droppedForReturns = 0;

  for (const [, g] of bySku) {
    g.sales.sort((a, b) => a.date.localeCompare(b.date));
    // Net returns against sales: keep (sales − returns) completed, plus returns refunded.
    const keepCompleted = Math.max(0, g.sales.length - g.returns.length);
    droppedForReturns += g.sales.length - keepCompleted;
    const completed = g.sales.slice(0, keepCompleted);
    const build = (u, status) => {
      const a3 = ALPHA2_TO_ALPHA3[u.country] ?? u.country;
      const rate = rateFor(u.cur, u.date);
      if (rate == null) noFx.add(u.cur);
      const amount = Number(u.cp.toFixed(2));
      const fee = Number((u.cp - u.ps).toFixed(2));
      const net = Number(u.ps.toFixed(2));
      const k = `${status === "refunded" ? "R" : "S"}:${u.country}:${u.sku}:${u.date}`;
      return {
        org_id: orgId, connector_id: connectorId,
        external_id: `appstore_rpt_${status === "refunded" ? "R" : "S"}_${u.country}_${u.sku}_${u.date}_${nextSeq(k)}`,
        type: "credit", amount, currency: u.cur,
        amount_base: rate != null ? Number((amount * rate).toFixed(2)) : null,
        base_currency: "INR", fx_rate: rate,
        category: null, counterparty_name: null,
        description: `${status === "refunded" ? "REFUND" : "SALE"} · ${u.sku}`,
        source: "app_store", status,
        transaction_date: u.date, transaction_at: null,
        metadata: { product_id: u.sku, storefront: a3, country: u.country, quantity: 1, fee, net, apple_identifier: u.apple_id, synthetic: true, source_report: "app_store_financial" },
      };
    };
    for (const u of completed) rows.push(build(u, "completed"));
    for (const u of g.returns) rows.push(build(u, "refunded"));
  }

  console.log(`Rows to book: ${rows.length}  (completed ${rows.filter((r) => r.status === "completed").length}, refunded ${rows.filter((r) => r.status === "refunded").length}; ${droppedForReturns} sales netted against returns)`);
  if (noFx.size) console.log(`  ⚠ no FX rate for: ${[...noFx].join(", ")} → amount_base left null (treated as INR by aggregates)`);

  // Sanity: net INR by month.
  const bymon = {};
  for (const r of rows) { const m = r.transaction_date.slice(0, 7); const b = r.amount_base ?? r.amount; bymon[m] = (bymon[m] || 0) + (r.status === "refunded" ? 0 : b); }
  console.log("Net completed INR by month:");
  Object.entries(bymon).sort().forEach(([m, v]) => console.log(`   ${m}  ₹${Math.round(v).toLocaleString("en-IN")}`));

  if (!COMMIT) { console.log("\nDRY RUN — pass --commit to write. Nothing inserted."); return; }

  // Dedup against existing external_ids, then insert only new.
  const ids = rows.map((r) => r.external_id);
  const existing = new Set();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await sb.from("transactions").select("external_id").eq("org_id", orgId).in("external_id", ids.slice(i, i + 300));
    for (const r of data ?? []) existing.add(r.external_id);
  }
  const fresh = rows.filter((r) => !existing.has(r.external_id));
  console.log(`\nInserting ${fresh.length} new (${existing.size} already present)…`);
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await sb.from("transactions").insert(fresh.slice(i, i + 500));
    if (error) throw new Error(`insert: ${error.message}`);
    inserted += Math.min(500, fresh.length - i);
  }
  console.log(`✓ Inserted ${inserted} historical App Store transactions.`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
