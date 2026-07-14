// Pull payment identifiers out of raw OCR text (no AI). The tokens feed the
// ID-only matcher in /api/transactions/search-by-image; amount/date are used only
// to raise a match's confidence, never as a search key. Pure + dependency-free so
// it runs in the browser and is unit-testable.

export type ParsedPayment = {
  tokens: string[];
  amount: number | null;
  currency: string | null;
  date: string | null; // YYYY-MM-DD when parseable
  method: string | null;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function extractDate(text: string): string | null {
  // ISO: 2026-05-27
  let m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // dd/mm/yyyy or dd-mm-yyyy (Indian apps) → assume day-first
  m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // "27 May 2026" / "27 May, 2026"
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*,?\s+(20\d{2})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}`;
  // "May 27, 2026"
  m = text.match(/\b([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${MONTHS[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
  return null;
}

export function parsePaymentText(text: string): ParsedPayment {
  const tokens = new Set<string>();

  // UPI VPA: name@bank (no dot after @)
  for (const m of text.matchAll(/[A-Za-z0-9.\-_]{2,}@[A-Za-z]{2,}\b/g)) tokens.add(m[0]);
  // email
  for (const m of text.matchAll(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)) tokens.add(m[0]);
  // Indian phone (10-digit, optional +91) — normalise to the bare 10 digits.
  // Guards prevent matching a phone-shaped slice inside a longer number (e.g. a UTR).
  for (const m of text.matchAll(/(?<![\d])(?:\+?91[\s-]?)?([6-9]\d{9})(?![\d])/g)) tokens.add(m[1]);
  // long digit runs — UTR / RRN / numeric payment ids (≥10 digits)
  for (const m of text.matchAll(/\b\d{10,}\b/g)) tokens.add(m[0]);
  // alphanumeric ids that contain BOTH a letter and a digit (order ids, cf_pay_*,
  // pay_*, mihpayid, CFPay_… with _ and -), length ≥ 8. Requiring both a letter and
  // a digit avoids matching plain words like "Payment" or "Successful".
  for (const m of text.matchAll(/\b[A-Za-z0-9][A-Za-z0-9_-]{7,}\b/g)) {
    const t = m[0];
    if (/[A-Za-z]/.test(t) && /\d/.test(t)) tokens.add(t);
  }

  // amount (display / confidence only)
  let amount: number | null = null;
  const amt = text.match(/(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  if (amt) { const n = Number(amt[1].replace(/,/g, "")); amount = Number.isFinite(n) ? n : null; }

  // payment method
  let method: string | null = null;
  if (/\bupi\b/i.test(text)) method = "UPI";
  else if (/\bimps\b/i.test(text)) method = "IMPS";
  else if (/\bneft\b/i.test(text)) method = "NEFT";
  else if (/\brtgs\b/i.test(text)) method = "RTGS";
  else if (/\b(?:debit|credit)\s*card\b|\bcard\b/i.test(text)) method = "Card";
  else if (/\bnet\s?banking\b/i.test(text)) method = "NetBanking";
  else if (/\bwallet\b/i.test(text)) method = "Wallet";

  const cleaned = [...tokens]
    .map((t) => t.trim().replace(/[^A-Za-z0-9@._-]/g, ""))
    .filter((t) => t.length >= 5 && t.length <= 64)
    .filter((t) => /[A-Za-z0-9]/.test(t));

  return {
    tokens: [...new Set(cleaned)].slice(0, 25),
    amount,
    currency: amount != null ? "INR" : null,
    date: extractDate(text),
    method,
  };
}
