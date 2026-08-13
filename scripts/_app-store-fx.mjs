// Shared FX + country mapping for App Store ops scripts. INR base.
// frankfurter (ECB) for majors; USD-peg for Gulf; static INR for exotics.

export const ALPHA2_TO_ALPHA3 = { AE:"ARE",AU:"AUS",AT:"AUT",BE:"BEL",BH:"BHR",BR:"BRA",CA:"CAN",CH:"CHE",CL:"CHL",CN:"CHN",CO:"COL",CY:"CYP",CZ:"CZE",DE:"DEU",DK:"DNK",EG:"EGY",ES:"ESP",FI:"FIN",FJ:"FJI",FR:"FRA",GB:"GBR",GR:"GRC",HK:"HKG",HR:"HRV",HU:"HUN",ID:"IDN",IE:"IRL",IL:"ISR",IN:"IND",IS:"ISL",IT:"ITA",JP:"JPN",KR:"KOR",KW:"KWT",LK:"LKA",LU:"LUX",MV:"MDV",MX:"MEX",MY:"MYS",MZ:"MOZ",NG:"NGA",NL:"NLD",NO:"NOR",NP:"NPL",NZ:"NZL",OM:"OMN",PH:"PHL",PK:"PAK",PL:"POL",PT:"PRT",QA:"QAT",RO:"ROU",RU:"RUS",SA:"SAU",SE:"SWE",SG:"SGP",TH:"THA",TR:"TUR",TW:"TWN",TZ:"TZA",UA:"UKR",US:"USA",VN:"VNM",ZA:"ZAF" };

const FRANKFURTER = new Set(["AUD","BGN","BRL","CAD","CHF","CNY","CZK","DKK","EUR","GBP","HKD","HUF","IDR","ILS","ISK","JPY","KRW","MXN","MYR","NOK","NZD","PHP","PLN","RON","SEK","SGD","THB","TRY","USD","ZAR"]);
const USD_PEG = { AED: 0.272294, SAR: 0.266667, QAR: 0.274725, OMR: 2.600780, BHD: 2.659574, KWD: 3.25 };
const STATIC_INR = { PKR: 0.30, TZS: 0.033, MZN: 1.35, NPR: 0.625, MVR: 5.42, LKR: 0.28, EGP: 1.75, RUB: 0.95, TWD: 2.65, VND: 0.0034, NGN: 0.057 };
const FX_BASE = "https://api.frankfurter.dev/v1";

const minusDays = (iso, d) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - d); return x.toISOString().slice(0, 10); };
async function fetchRange(cur, from, to) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${FX_BASE}/${from}..${to}?from=${cur}&to=INR`, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`FX ${cur} ${res.status}`);
      const j = await res.json();
      const m = new Map();
      for (const [d, o] of Object.entries(j.rates ?? {})) if (typeof o?.INR === "number") m.set(d, o.INR);
      return m;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}
const nearestPrior = (map, date) => {
  if (map.has(date)) return map.get(date);
  let best = null;
  for (const [d, r] of map) if (d <= date && (best === null || d > best[0])) best = [d, r];
  return best ? best[1] : null;
};

/** Build a rate resolver over [minDate,maxDate] for the given currencies. Returns
 *  { rateFor(cur,date) → INR-per-unit | null, missing: Set }. */
export async function buildFx(currencies, minDate, maxDate) {
  const from = minusDays(minDate, 10), to = maxDate;
  const maps = new Map();
  let usdMap = null;
  const needUsd = currencies.some((c) => USD_PEG[c]) || currencies.includes("USD");
  if (needUsd) usdMap = await fetchRange("USD", from, to);
  for (const c of currencies) {
    if (c === "INR" || c === "USD") continue;
    if (FRANKFURTER.has(c)) { try { maps.set(c, await fetchRange(c, from, to)); } catch (e) { console.warn(`  FX fail ${c}: ${e.message}`); } }
  }
  if (usdMap) maps.set("USD", usdMap);
  const missing = new Set();
  const rateFor = (cur, date) => {
    if (cur === "INR") return 1;
    if (maps.has(cur)) { const r = nearestPrior(maps.get(cur), date); if (r != null) return r; }
    if (USD_PEG[cur] && usdMap) { const u = nearestPrior(usdMap, date); if (u != null) return USD_PEG[cur] * u; }
    if (STATIC_INR[cur]) return STATIC_INR[cur];
    missing.add(cur);
    return null;
  };
  return { rateFor, missing };
}
