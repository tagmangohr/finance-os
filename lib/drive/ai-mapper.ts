import Anthropic from "@anthropic-ai/sdk";
import { EMPTY_MAPPING, type DriveColumnMapping } from "./types";

const client = new Anthropic();

// ─── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(headers: string[], sampleRows: string[][]): string {
  const headerLine = headers.join(" | ");
  const sampleLines = sampleRows.slice(0, 5).map((row) => row.join(" | ")).join("\n");

  return `You are a financial data analyst. You have been given column headers and sample rows from a spreadsheet that contains bank or payment transactions.

Your task: map each column to one of the following semantic fields. Return a JSON object where each key is a semantic field name and the value is the exact column header that best matches (or null if no column matches).

SEMANTIC FIELDS:
- "date"         → Transaction date (any date/time column)
- "amount"       → Single amount column where positive = credit inflow, negative = debit outflow
- "debit"        → A debit-only column (money going OUT)
- "credit"       → A credit-only column (money coming IN)
- "type"         → A column that indicates direction: e.g. "DR"/"CR", "debit"/"credit", "+"/"-"
- "description"  → Description, narration, particulars, memo, remarks
- "counterparty" → Payee, payer, beneficiary, merchant, vendor, customer name
- "currency"     → Currency code column
- "reference"    → Transaction reference ID, UTR number, transaction ID, cheque number

RULES:
1. Use "debit" + "credit" when amounts are split across two separate columns.
2. Use "amount" + "type" when there is one amount column plus a direction indicator.
3. Use "amount" alone when the sign of the number indicates direction.
4. Never assign the same column to more than one field.
5. Return ONLY a valid JSON object — no explanation, no markdown, no code fences.

COLUMN HEADERS:
${headerLine}

SAMPLE DATA (up to 5 rows):
${sampleLines}

Return JSON:`;
}

// ─── AI mapping ───────────────────────────────────────────────────────────────

/** Calls Claude to analyse the spreadsheet headers and sample rows, and returns
 *  a best-guess DriveColumnMapping.  Falls back to an empty mapping on any error. */
export async function aiMapColumns(
  headers: string[],
  sampleRows: string[][]
): Promise<DriveColumnMapping> {
  try {
    const response = await client.messages.create({
      model:      "claude-haiku-4-5",   // fast + cheap for this structured task
      max_tokens: 512,
      messages:   [{ role: "user", content: buildPrompt(headers, sampleRows) }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

    // Strip accidental markdown fences
    const clean = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

    const raw = JSON.parse(clean) as Record<string, string | null>;

    // Only accept values that are actual column headers or null
    const headerSet = new Set(headers);
    const mapping: DriveColumnMapping = { ...EMPTY_MAPPING };
    const assigned = new Set<string>();

    for (const [field, col] of Object.entries(raw)) {
      if (!col || !headerSet.has(col) || assigned.has(col)) continue;
      if (field in mapping) {
        (mapping as Record<string, string | null>)[field] = col;
        assigned.add(col);
      }
    }

    return mapping;
  } catch (err) {
    console.error("[ai-mapper] Failed to map columns:", err);
    return { ...EMPTY_MAPPING };
  }
}

// ─── Rule-based fallback ──────────────────────────────────────────────────────
// Used when the AI result is empty or as a cross-check.

export function ruleBasedMap(headers: string[]): Partial<DriveColumnMapping> {
  const mapping: Partial<DriveColumnMapping> = {};

  for (const h of headers) {
    const lower = h.toLowerCase().trim();

    if (!mapping.date && /\b(date|dt|txn[_\s]?date|trans[_\s]?date|value[_\s]?date)\b/.test(lower))
      mapping.date = h;

    if (!mapping.debit && /\b(debit|dr\.?|withdrawal|paid[_\s]?out|outflow|amount[_\s]?dr)\b/.test(lower))
      mapping.debit = h;

    if (!mapping.credit && /\b(credit|cr\.?|deposit|received|paid[_\s]?in|inflow|amount[_\s]?cr)\b/.test(lower))
      mapping.credit = h;

    if (!mapping.amount && !mapping.debit && !mapping.credit &&
        /\b(amount|amt|value|transaction[_\s]?amount|txn[_\s]?amount)\b/.test(lower))
      mapping.amount = h;

    if (!mapping.type && /\b(type|txn[_\s]?type|cr\/?dr|dr\/?cr|direction|indicator)\b/.test(lower))
      mapping.type = h;

    if (!mapping.description && /\b(description|narration|particulars|remarks|memo|details|note)\b/.test(lower))
      mapping.description = h;

    if (!mapping.counterparty && /\b(counterparty|payee|payer|vendor|merchant|beneficiary|sender|receiver)\b/.test(lower))
      mapping.counterparty = h;

    if (!mapping.currency && /^currency$/.test(lower))
      mapping.currency = h;

    if (!mapping.reference && /\b(ref(?:erence)?|utr|txn[_\s]?id|transaction[_\s]?id|id|cheque|check)\b/.test(lower))
      mapping.reference = h;
  }

  return mapping;
}

/** Returns an AI mapping merged with rule-based fallbacks for any null fields. */
export async function getColumnMapping(
  headers: string[],
  sampleRows: string[][]
): Promise<DriveColumnMapping> {
  const [aiResult, ruleResult] = await Promise.all([
    aiMapColumns(headers, sampleRows),
    Promise.resolve(ruleBasedMap(headers)),
  ]);

  // AI takes precedence; rule-based fills gaps
  const merged: DriveColumnMapping = { ...EMPTY_MAPPING };
  const usedCols = new Set<string>();

  for (const key of Object.keys(EMPTY_MAPPING) as (keyof DriveColumnMapping)[]) {
    const aiVal = aiResult[key];
    const ruleVal = ruleResult[key];

    if (aiVal && !usedCols.has(aiVal)) {
      merged[key] = aiVal;
      usedCols.add(aiVal);
    } else if (ruleVal && !usedCols.has(ruleVal)) {
      merged[key] = ruleVal;
      usedCols.add(ruleVal);
    }
  }

  return merged;
}
