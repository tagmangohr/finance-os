// One-shot historical loader for Apple App Store Financial Reports.
// Parses the monthly TSVs, replaces each period's lines, derives (country × sku)
// payout rates, and attributes metadata.fee onto existing app_store transactions
// via the backfill_app_store_fees RPC. Requires migration 072 to be applied.
//
// Canonical parser lives in lib/connectors/app-store-report.ts (used by the route
// + UI); this is a self-contained copy so it can run under plain node (no tsx / no
// @/ alias resolution). Keep the two in sync if the format ever changes.
//
// Usage:  node scripts/load-app-store-reports.mjs "/Users/raviagarwal/Desktop/Apple Pay Trnxs"

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ── env (.env.local) ─────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const REPORT_DIR = process.argv[2] || "/Users/raviagarwal/Desktop/Apple Pay Trnxs";

const ALPHA2_TO_ALPHA3 = {
  AE: "ARE", AU: "AUS", AT: "AUT", BE: "BEL", BH: "BHR", BR: "BRA", CA: "CAN",
  CH: "CHE", CL: "CHL", CN: "CHN", CO: "COL", CY: "CYP", CZ: "CZE", DE: "DEU",
  DK: "DNK", EG: "EGY", ES: "ESP", FI: "FIN", FJ: "FJI", FR: "FRA", GB: "GBR",
  GR: "GRC", HK: "HKG", HR: "HRV", HU: "HUN", ID: "IDN", IE: "IRL", IL: "ISR",
  IN: "IND", IS: "ISL", IT: "ITA", JP: "JPN", KR: "KOR", KW: "KWT", LK: "LKA",
  LU: "LUX", MV: "MDV", MX: "MEX", MY: "MYS", MZ: "MOZ", NG: "NGA", NL: "NLD",
  NO: "NOR", NP: "NPL", NZ: "NZL", OM: "OMN", PH: "PHL", PK: "PAK", PL: "POL",
  PT: "PRT", QA: "QAT", RO: "ROU", RU: "RUS", SA: "SAU", SE: "SWE", SG: "SGP",
  TH: "THA", TR: "TUR", TW: "TWN", TZ: "TZA", UA: "UKR", US: "USA", VN: "VNM",
  ZA: "ZAF",
};

const toISODate = (s) => {
  const m = String(s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
const toNum = (s) => {
  const n = Number(String(s ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};

function parseReport(text) {
  const rows = text.split(/\r?\n/).map((l) => l.split("\t"));
  let periodStart = null, periodEnd = null, skipped = 0;
  const lines = [];
  for (const cols of rows) {
    const first = (cols[0] ?? "").trim();
    if (first === "Start Date") { periodStart = toISODate(cols[1]); continue; }
    if (first === "End Date") { periodEnd = toISODate(cols[1]); continue; }
    if (first === "Vendor Name") continue;
    if (first === "Transaction Date") continue;
    if (first === "Country Of Sale" || first === "Country of Sale") break;
    if (cols.length === 1 && first === "") continue;
    const sr = (cols[14] ?? "").trim().toUpperCase();
    if (cols.length < 15 || (sr !== "S" && sr !== "R")) { if (first !== "") skipped++; continue; }
    lines.push({
      transaction_date: toISODate(cols[0]),
      settlement_date: toISODate(cols[1]),
      apple_identifier: (cols[2] ?? "").trim() || null,
      sku: (cols[3] ?? "").trim() || null,
      title: (cols[4] ?? "").trim() || null,
      product_type: (cols[6] ?? "").trim() || null,
      country: (cols[7] ?? "").trim().toUpperCase(),
      quantity: Math.trunc(toNum(cols[8])),
      partner_share: toNum(cols[9]),
      extended_partner_share: toNum(cols[10]),
      partner_currency: (cols[11] ?? "").trim().toUpperCase() || null,
      customer_price: toNum(cols[12]),
      customer_currency: (cols[13] ?? "").trim().toUpperCase() || null,
      sale_or_return: sr,
      promo_code: (cols[15] ?? "").trim() || null,
      order_type: (cols[16] ?? "").trim() || null,
      region: (cols[17] ?? "").trim() || null,
    });
  }
  const reportPeriod = `${periodStart ?? "?"}..${periodEnd ?? "?"}`;
  for (const l of lines) { l.report_period = reportPeriod; l.period_start = periodStart; l.period_end = periodEnd; }
  return { reportPeriod, periodStart, periodEnd, lines, skipped };
}

function deriveRates(lines) {
  const byKey = new Map();
  for (const l of lines) {
    if (l.sale_or_return !== "S" || !l.sku || !l.country) continue;
    if (l.customer_price <= 0 || l.quantity <= 0) continue;
    if (l.customer_currency && l.partner_currency && l.customer_currency !== l.partner_currency) continue;
    const key = `${l.country}::${l.sku}`;
    const gross = l.customer_price * l.quantity;
    const net = l.extended_partner_share;
    const acc = byKey.get(key);
    if (!acc) byKey.set(key, { country: l.country, sku: l.sku, currency: l.customer_currency, grossSum: gross, netSum: net, units: l.quantity, sampleCP: l.customer_price, samplePS: l.partner_share, sampleUnits: l.quantity });
    else {
      acc.grossSum += gross; acc.netSum += net; acc.units += l.quantity;
      if (l.quantity > acc.sampleUnits) { acc.sampleUnits = l.quantity; acc.sampleCP = l.customer_price; acc.samplePS = l.partner_share; }
    }
  }
  const out = [];
  for (const a of byKey.values()) {
    if (a.grossSum <= 0) continue;
    const ratio = a.netSum / a.grossSum;
    if (!(ratio > 0 && ratio <= 1)) continue;
    out.push({
      country_alpha2: a.country, country_alpha3: ALPHA2_TO_ALPHA3[a.country] ?? null,
      sku: a.sku, payout_ratio: Number(ratio.toFixed(6)),
      sample_customer_price: a.sampleCP, sample_partner_share: a.samplePS,
      currency: a.currency, units: a.units,
    });
  }
  return out;
}

async function insertChunked(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main() {
  // Resolve the app_store connector + org.
  const { data: conns, error: cErr } = await sb
    .from("connectors").select("id, org_id, name, status").eq("type", "app_store");
  if (cErr) throw new Error(`connectors: ${cErr.message}`);
  const active = (conns ?? []).filter((c) => c.status === "active");
  if (active.length === 0) throw new Error("No active app_store connector found");
  if (active.length > 1) throw new Error(`Multiple app_store connectors: ${active.map((c) => c.id).join(", ")} — narrow it down`);
  const { id: connectorId, org_id: orgId } = active[0];
  console.log(`Connector ${connectorId} · org ${orgId}`);

  const files = readdirSync(REPORT_DIR).filter((f) => /\.(txt|tsv)$/i.test(f)).sort();
  if (files.length === 0) throw new Error(`No .txt/.tsv files in ${REPORT_DIR}`);
  console.log(`Files: ${files.join(", ")}`);

  let totalLines = 0;
  for (const name of files) {
    const parsed = parseReport(readFileSync(join(REPORT_DIR, name), "utf8"));
    if (parsed.lines.length === 0) { console.log(`  ${name}: 0 rows (skipped ${parsed.skipped})`); continue; }
    const { error: delErr } = await sb.from("app_store_financial_lines")
      .delete().eq("org_id", orgId).eq("report_period", parsed.reportPeriod);
    if (delErr) throw new Error(`delete ${parsed.reportPeriod}: ${delErr.message}`);
    const rows = parsed.lines.map((l) => ({ ...l, org_id: orgId, connector_id: connectorId }));
    await insertChunked("app_store_financial_lines", rows);
    totalLines += rows.length;
    console.log(`  ${name} [${parsed.reportPeriod}]: ${rows.length} rows (skipped ${parsed.skipped})`);
  }

  // Rebuild rates from ALL the org's sale lines.
  const allLines = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("app_store_financial_lines")
      .select("country, sku, sale_or_return, quantity, partner_share, extended_partner_share, customer_price, customer_currency, partner_currency")
      .eq("org_id", orgId).eq("sale_or_return", "S").range(from, from + 999);
    if (error) throw new Error(`read lines: ${error.message}`);
    allLines.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const rates = deriveRates(allLines);
  const { error: drErr } = await sb.from("app_store_payout_rates").delete().eq("org_id", orgId);
  if (drErr) throw new Error(`clear rates: ${drErr.message}`);
  await insertChunked("app_store_payout_rates", rates.map((r) => ({ ...r, org_id: orgId })));
  console.log(`Rates: ${rates.length} (country × sku)`);

  // Attribute fees onto existing transactions.
  const { data: n, error: rpcErr } = await sb.rpc("backfill_app_store_fees", { p_org: orgId, p_overwrite: false });
  if (rpcErr) throw new Error(`backfill: ${rpcErr.message}`);
  console.log(`\n✓ Lines: ${totalLines} · Rates: ${rates.length} · Fees attributed: ${n}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
