// Read-only diagnostic: App Store fee coverage + July reconciliation.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: conns } = await sb.from("connectors").select("id, org_id").eq("type", "app_store").eq("status", "active");
const { org_id: orgId } = conns[0];

// ── Pull all app_store transactions (id, amount, date, metadata) ──
const txns = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await sb.from("transactions")
    .select("id, amount, transaction_date, currency, metadata, status")
    .eq("org_id", orgId).eq("source", "app_store").range(from, from + 999);
  if (error) throw new Error(error.message);
  txns.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}

const total = txns.length;
const withFee = txns.filter((t) => t.metadata && t.metadata.fee != null).length;
const withStorefront = txns.filter((t) => t.metadata && t.metadata.storefront).length;
const withSku = txns.filter((t) => t.metadata && t.metadata.product_id).length;
const withBoth = txns.filter((t) => t.metadata && t.metadata.storefront && t.metadata.product_id).length;

console.log("── App Store transactions (relay) ──");
console.log(`  total:            ${total}`);
console.log(`  has storefront:   ${withStorefront}`);
console.log(`  has product_id:   ${withSku}`);
console.log(`  has both keys:    ${withBoth}`);
console.log(`  fee stamped:      ${withFee}`);

// Distinct storefront values actually present on transactions.
const storefronts = {};
for (const t of txns) { const s = t.metadata?.storefront ?? "(null)"; storefronts[s] = (storefronts[s] || 0) + 1; }
console.log("\n── storefront values on transactions ──");
console.log("  " + Object.entries(storefronts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  "));

// Rate table alpha3 coverage.
const { data: rates } = await sb.from("app_store_payout_rates").select("country_alpha2, country_alpha3, sku").eq("org_id", orgId);
const alpha3set = new Set(rates.filter((r) => r.country_alpha3).map((r) => r.country_alpha3));
const missingAlpha3 = [...new Set(rates.filter((r) => !r.country_alpha3).map((r) => r.country_alpha2))];
console.log("\n── rate table ──");
console.log(`  rate rows: ${rates.length} · distinct alpha3: ${alpha3set.size}`);
if (missingAlpha3.length) console.log(`  alpha2 with NO alpha3 mapping: ${missingAlpha3.join(", ")}`);

// Which transactions failed to match a rate?
const rateKeys = new Set(rates.filter((r) => r.country_alpha3).map((r) => `${r.country_alpha3}:${r.sku}`));
const unmatched = txns.filter((t) => t.amount > 0 && t.metadata?.storefront && t.metadata?.product_id && !rateKeys.has(`${t.metadata.storefront}:${t.metadata.product_id}`));
console.log(`\n── unmatched (has keys but no rate): ${unmatched.length} ──`);
const um = {};
for (const t of unmatched) { const k = `${t.metadata.storefront}:${t.metadata.product_id}`; um[k] = (um[k] || 0) + 1; }
Object.entries(um).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

// ── July reconciliation: relay vs report, per (country × sku) ──
// Relay July = transactions dated 2026-07 (+ 08-01 which is in the fiscal report).
console.log("\n── JULY reconciliation (relay txns vs report lines) ──");
const { data: jlines } = await sb.from("app_store_financial_lines")
  .select("country, sku, quantity, customer_price, sale_or_return")
  .eq("org_id", orgId).eq("report_period", "2026-06-28..2026-08-01");
// Report side: net units (S − R) and gross per (country_alpha3, sku).
const ALPHA2_TO_ALPHA3 = { AE:"ARE",AU:"AUS",BE:"BEL",BH:"BHR",BR:"BRA",CA:"CAN",CH:"CHE",CY:"CYP",DE:"DEU",ES:"ESP",FI:"FIN",FJ:"FJI",FR:"FRA",GB:"GBR",HK:"HKG",HR:"HRV",IE:"IRL",IN:"IND",IS:"ISL",IT:"ITA",JP:"JPN",KR:"KOR",KW:"KWT",MV:"MDV",MY:"MYS",MZ:"MOZ",NL:"NLD",NP:"NPL",NZ:"NZL",OM:"OMN",PH:"PHL",PK:"PAK",PT:"PRT",QA:"QAT",RU:"RUS",SA:"SAU",SE:"SWE",SG:"SGP",TH:"THA",TR:"TUR",TW:"TWN",TZ:"TZA",US:"USA",ZA:"ZAF" };
const rep = {};
let repUnits = 0, repGross = 0;
for (const l of jlines) {
  const a3 = ALPHA2_TO_ALPHA3[l.country] ?? l.country;
  const k = `${a3}:${l.sku}`;
  const q = l.quantity; // signed (R negative)
  rep[k] = rep[k] || { units: 0 };
  rep[k].units += q;
  repUnits += q; repGross += l.customer_price * q;
}
// Relay side: count txns whose fiscal date falls in the report window.
const inJuly = (d) => d >= "2026-06-28" && d <= "2026-08-01";
const relay = {};
let relayCount = 0, relayGross = 0;
for (const t of txns) {
  if (!inJuly(t.transaction_date)) continue;
  const sign = t.status === "refunded" ? -1 : 1;
  const k = `${t.metadata?.storefront}:${t.metadata?.product_id}`;
  relay[k] = relay[k] || { count: 0 };
  relay[k].count += sign;
  relayCount += sign; relayGross += sign * (t.amount || 0);
}
console.log(`  relay: ${relayCount} net txns   report: ${repUnits} net units`);
console.log(`  (gross not currency-normalized; per-key net-unit deltas below)`);
const keys = [...new Set([...Object.keys(rep), ...Object.keys(relay)])].sort();
let mismatches = 0;
for (const k of keys) {
  const r = relay[k]?.count ?? 0, p = rep[k]?.units ?? 0;
  if (r !== p) { mismatches++; if (mismatches <= 25) console.log(`  Δ ${k}  relay=${r}  report=${p}  (diff ${r - p})`); }
}
console.log(`  keys with a net-count mismatch: ${mismatches} / ${keys.length}`);
