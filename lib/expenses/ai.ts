import Anthropic from "@anthropic-ai/sdk";
import type { LedgerCategory } from "./types";

// Cheap, high-volume model for structured categorization.
const MODEL = "claude-haiku-4-5-20251001";
const BATCH = 40;

/**
 * Whether the AI layer can run. The key is a placeholder/unset in this project's
 * prod today, so this gates the whole AI path — when false, categorization runs
 * on the deterministic rules layer only (still fully functional).
 */
export function aiAvailable(): boolean {
  const k = process.env.ANTHROPIC_API_KEY ?? "";
  return k.length > 20 && !/placeholder|your-key|sk-ant-xxx/i.test(k);
}

export type AiTxn = {
  id: string;
  counterparty: string | null;
  description: string | null;
  kind: string | null;
  type: "credit" | "debit";
  amount: number;
};

type Example = { counterparty: string | null; description: string | null; slug: string };

/**
 * Categorize bank transactions with Claude. Returns id → {slug, confidence} only
 * for rows the model classified into a VALID taxonomy slug. Never throws — a
 * missing/invalid key or a malformed response yields an empty map, so the caller
 * simply leaves those rows for manual review.
 */
export async function aiCategorize(
  txns: AiTxn[],
  cats: LedgerCategory[],
  examples: Example[]
): Promise<Map<string, { slug: string; confidence: number }>> {
  const out = new Map<string, { slug: string; confidence: number }>();
  if (!aiAvailable() || txns.length === 0) return out;

  const validSlugs = new Set(cats.map((c) => c.slug));
  const taxonomy = cats.map((c) => `- ${c.slug} — ${c.label} (flow: ${c.flow}, P&L: ${c.treatment})`).join("\n");
  const fewshot = examples
    .slice(0, 20)
    .map((e) => `- "${(e.counterparty ?? e.description ?? "").slice(0, 60)}" → ${e.slug}`)
    .join("\n");

  const system =
    `You are a bookkeeping assistant categorizing BANK transactions into a fixed taxonomy.\n\n` +
    `Categories (use the slug exactly):\n${taxonomy}\n\n` +
    `Guidance:\n` +
    `- A debit (money out) is almost always an expense; a credit (money in) is income or excluded.\n` +
    `- Payouts/settlements FROM a payment gateway (Stripe, Razorpay, Cashfree, PayU) are "pg_settlement" — money already counted as revenue.\n` +
    `- Internal transfers, owner draws, loan movements and capital are "excluded" (cash moved, not P&L).\n` +
    `- If genuinely unsure, use "uncategorized" with low confidence rather than guessing.\n` +
    `Return ONLY a JSON array, no prose.`;

  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
    return out;
  }

  for (let i = 0; i < txns.length; i += BATCH) {
    const chunk = txns.slice(i, i + BATCH);
    const user =
      (fewshot ? `Prior human decisions to learn from:\n${fewshot}\n\n` : "") +
      `Categorize each transaction below. Return a JSON array of ` +
      `{"id": string, "slug": string, "confidence": number 0-1}, one per transaction.\n\n` +
      `Transactions:\n${JSON.stringify(chunk)}`;

    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system,
        messages: [{ role: "user", content: user }],
      });
      const block = resp.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") continue;
      const parsed = extractJsonArray(block.text);
      for (const row of parsed) {
        const id = String(row?.id ?? "");
        const slug = String(row?.slug ?? "");
        const confidence = Number(row?.confidence);
        if (id && validSlugs.has(slug)) {
          out.set(id, { slug, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5 });
        }
      }
    } catch {
      // A failed batch (bad key, rate limit, parse error) just leaves that chunk
      // for manual review — never aborts the whole run.
      continue;
    }
  }
  return out;
}

/** Pull the first JSON array out of a model response (tolerates code fences/prose). */
function extractJsonArray(text: string): Array<Record<string, unknown>> {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
