// ─── Counterparty extraction from bank-statement narration ─────────────────────
// Bank statements (ICICI/RBL/HDFC/…) rarely carry a dedicated party column — the
// beneficiary/remitter name is embedded inside the transaction remark, e.g.
//   NEFT-HDFCH00901777763-AMAN SETHI-0001NB…-19551010000144-HDFC0000001   → AMAN SETHI
//   RTGS/UTIBH26092946802/CASHFREE PAYMENTS INDIA PRIV                     → CASHFREE PAYMENTS INDIA PRIV
//   617125017249-TAGMANGO WALLET WITHDRAWAL RZPSINVY96Q2H                  → TAGMANGO WALLET WITHDRAWAL
//   NEFT/000517870865/HDFC/I Deserve Life Systems LLP/                     → I Deserve Life Systems LLP
//   UBER *TRIP                                                            → UBER
// so when a sheet has no counterparty column we derive it from the remark.
//
// Approach: the name is the longest contiguous run of "clean" words (letters only —
// no digits, which mark refs / IFSC codes / account & txn numbers) within any
// `/`, `-` or `|`-delimited field, excluding payment-rail keywords and standalone
// bank codes. Word-run (not whole-segment) matching means a ref glued to the name by
// a space ("… WITHDRAWAL RZPS96Q2H") still yields the clean name.

// Payment-rail / channel keywords that are never a counterparty on their own.
const RAIL_STOP = new Set([
  "NEFT", "RTGS", "IMPS", "UPI", "INF", "INFT", "IMP", "MMT", "ACH", "API", "IB",
  "NACH", "ECS", "POS", "ATM", "EMI", "TPFT", "FT", "BIL", "BILLPAY", "CMS", "TRTR",
  "GRS", "GIB", "PAYMENT", "PAYMENTS", "TRANSFER", "TRANSFE", "FUND", "PVT", "LTD",
  "PVTLTD", "GST", "CGST", "SGST", "IGST", "THE",
]);

// Common Indian bank / IFSC prefixes — appear as a standalone field in IMPS-API
// remarks (…/IMP/API/HDFC/<acct>/…) and are the routing bank, not the counterparty.
const BANK_STOP = new Set([
  "HDFC", "ICIC", "SBIN", "UTIB", "KKBK", "YESB", "YESF", "AXIS", "IDFB", "IDIB",
  "PUNB", "BARB", "CNRB", "UBIN", "IOBA", "FDRL", "RATN", "KARB", "INDB", "CBIN",
  "MAHB", "IBKL", "BKID", "PYTM", "AIRP", "HSBC", "CITI", "SCBL", "DBSS", "ANDB",
  "CORP", "VIJB", "ORBC", "SIBL", "TMBL", "KVBL", "LAVB", "DCBL", "BOFA", "JSFB",
]);

// A "word" that could be part of a name: starts with a letter, then only letters or
// name punctuation (. & '). Anything with a digit, @, :, ~ etc. is a ref, not a name.
const isCleanWord = (w: string): boolean => /^[A-Za-z][A-Za-z.&']*$/.test(w);

/**
 * Best-effort counterparty from a bank narration string. Returns null when nothing
 * name-like is present (leaves the field null rather than storing a ref/bank code).
 * Pure + deterministic — the same row always derives the same name (idempotent across
 * syncs) — and never touches amount/date/category (display metadata only).
 */
export function deriveCounterparty(narration: string | null | undefined): string | null {
  if (!narration) return null;
  const s = String(narration).trim();
  if (!s) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (let segment of s.split(/[/\-|]/)) {
    segment = segment.trim();
    if (!segment) continue;
    // Card networks append "*<memo>" (UBER *TRIP, AMAZON*MKTP) — keep the merchant.
    if (segment.includes("*")) segment = segment.split("*")[0].trim();

    // Longest contiguous run of clean words within this field.
    const words = segment.split(/\s+/);
    const runs: string[][] = [];
    let run: string[] = [];
    for (const w of words) {
      if (isCleanWord(w)) run.push(w);
      else { if (run.length) runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);

    for (const r of runs) {
      const cand = r.join(" ");
      const letters = cand.replace(/[^A-Za-z]/g, "").length;
      if (letters < 4) continue;
      const compact = cand.toUpperCase().replace(/[^A-Z]/g, "");
      if (RAIL_STOP.has(compact) || BANK_STOP.has(compact)) continue; // isolated rail/bank code
      if (letters > bestScore) { bestScore = letters; best = cand; }
    }
  }

  return best ? best.replace(/\s+/g, " ").trim() : null;
}
