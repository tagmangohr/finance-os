import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY (same as the AI chat)

// Vision-capable model already provisioned on this account (matches lib/intelligence/claude.ts).
const MODEL = "claude-sonnet-4-5";

type Extracted = {
  amount: number | null;
  currency: string | null;
  date: string | null;
  datetime: string | null;
  ids: string[];
  upi_ref: string | null;
  upi_id: string | null;
  email: string | null;
  phone: string | null;
  counterparty_name: string | null;
  method: string | null;
  summary: string | null;
};

type MatchRow = {
  id: string; transaction_date: string; transaction_at: string | null;
  source: string; type: string; amount: number; currency: string; status: string;
  counterparty_name: string | null; description: string | null; external_id: string | null;
  category: string | null; metadata: unknown;
};

type Confidence = "high" | "medium" | "low";
type Ranked = MatchRow & { confidence: Confidence; matched_on: string; amount_matches: boolean };

const EXTRACT_PROMPT = `You are reading a screenshot of a payment — it could be a UPI app (GPay/PhonePe/Paytm), a bank SMS or statement, a payment-gateway receipt, or an email confirmation.

Extract every identifier and detail you can see and return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{
  "amount": number or null,              // the transaction amount as a number, no currency symbol
  "currency": string or null,            // ISO 4217 code, e.g. "INR", "USD"; default "INR" if a ₹ sign is shown
  "date": string or null,                // ISO date YYYY-MM-DD if visible
  "datetime": string or null,            // ISO 8601 timestamp if a time is visible
  "ids": string[],                       // ALL reference/transaction/UTR/RRN/order/UPI-transaction IDs visible (verbatim strings)
  "upi_ref": string or null,             // UPI reference / UTR number if labelled as such
  "upi_id": string or null,              // a VPA like name@bank if visible
  "email": string or null,               // customer email if visible
  "phone": string or null,               // customer phone if visible
  "counterparty_name": string or null,   // the payer/payee name if visible
  "method": string or null,              // "UPI" | "Card" | "NetBanking" | "Wallet" | ... if identifiable
  "summary": string or null              // one short line describing what the screenshot shows
}
Copy IDs exactly as shown including letters, digits, and separators. If a value is not visible, use null (or [] for ids). Return the JSON object and nothing else.`;

/** Pull the first {...} JSON object out of the model text and parse it. */
function parseExtracted(text: string): Extracted | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<Extracted>;
    return {
      amount: typeof raw.amount === "number" ? raw.amount : null,
      currency: raw.currency ?? null,
      date: raw.date ?? null,
      datetime: raw.datetime ?? null,
      ids: Array.isArray(raw.ids) ? raw.ids.map(String) : [],
      upi_ref: raw.upi_ref ?? null,
      upi_id: raw.upi_id ?? null,
      email: raw.email ?? null,
      phone: raw.phone ?? null,
      counterparty_name: raw.counterparty_name ?? null,
      method: raw.method ?? null,
      summary: raw.summary ?? null,
    };
  } catch {
    return null;
  }
}

/** Identifier tokens to match on — IDs, UPI ref/VPA, email, phone. Amount is
 *  deliberately NOT a token (too many payments share an amount). */
function buildTokens(e: Extracted): string[] {
  const raw = [...e.ids, e.upi_ref, e.upi_id, e.email, e.phone].filter(Boolean) as string[];
  const cleaned = raw
    .map((t) => t.trim())
    // keep only characters safe inside a PostgREST or() filter; drop the rest
    .map((t) => t.replace(/[^A-Za-z0-9@._-]/g, ""))
    .filter((t) => t.length >= 5); // very short tokens match too much
  return [...new Set(cleaned)];
}

const MATCH_COLS =
  "id, transaction_date, transaction_at, source, type, amount, currency, status, counterparty_name, description, external_id, category, metadata";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string; image?: string; media_type?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const orgId = body.org_id;
  if (!orgId) return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  if (!body.image) return NextResponse.json({ error: "image is required" }, { status: 400 });

  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;

  // Accept a data URL or a bare base64 string.
  let data = body.image;
  let mediaType = body.media_type || "image/png";
  if (data.startsWith("data:")) {
    const comma = data.indexOf(",");
    if (comma > 0) {
      const mt = data.slice(5, comma).split(";")[0]; // "image/png"
      if (mt.startsWith("image/")) mediaType = mt;
      data = data.slice(comma + 1);
    }
  }
  // Guard payload size (~5MB base64 ≈ 3.75MB image — within Claude's limit).
  if (data.length > 7_000_000) return NextResponse.json({ error: "Image too large (max ~5MB)" }, { status: 413 });

  // 1) Read the screenshot with Claude vision.
  let extracted: Extracted | null;
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType as "image/png", data } },
            { type: "text", text: EXTRACT_PROMPT },
          ],
        },
      ],
    });
    const textBlock = resp.content.find((b) => b.type === "text");
    extracted = textBlock && textBlock.type === "text" ? parseExtracted(textBlock.text) : null;
  } catch (err) {
    return NextResponse.json({ error: `Could not read the screenshot: ${err instanceof Error ? err.message : "vision error"}` }, { status: 502 });
  }
  if (!extracted) return NextResponse.json({ error: "Could not read a payment from that screenshot." }, { status: 422 });

  const tokens = buildTokens(extracted);

  // 2) Match ONLY on identifiers (never amount). Search the search_text blob
  //    (external_id + description + counterparty) plus common metadata id fields.
  const supabase = auth.supabase;
  const found = new Map<string, Ranked>();
  if (tokens.length > 0) {
    const perToken = await Promise.all(
      tokens.map(async (tok) => {
        const filter = [
          `search_text.ilike.*${tok}*`,
          `external_id.ilike.*${tok}*`,
          `metadata->>order_id.ilike.*${tok}*`,
          `metadata->>utr.ilike.*${tok}*`,
          `metadata->>cf_payment_id.ilike.*${tok}*`,
          `metadata->>bank_ref_no.ilike.*${tok}*`,
          `metadata->>rrn.ilike.*${tok}*`,
          `metadata->>transaction_id.ilike.*${tok}*`,
        ].join(",");
        const { data: rows } = await supabase
          .from("transactions")
          .select(MATCH_COLS)
          .eq("org_id", orgId)
          .or(filter)
          .limit(15);
        return { tok, rows: (rows ?? []) as unknown as MatchRow[] };
      })
    );

    // 3) Rank + annotate confidence. Amount/date are used ONLY to raise confidence.
    const amt = extracted.amount;
    const day = (extracted.date ?? extracted.datetime ?? "").slice(0, 10);
    for (const { tok, rows } of perToken) {
      for (const r of rows) {
        const lower = tok.toLowerCase();
        const inExternal = (r.external_id ?? "").toLowerCase().includes(lower);
        const amountMatches = amt != null && Math.abs(Number(r.amount) - amt) < 0.01;
        const dateClose = !!day && !!r.transaction_date &&
          Math.abs(new Date(r.transaction_date).getTime() - new Date(day).getTime()) <= 5 * 86400000;
        const confidence: Confidence =
          inExternal || amountMatches ? "high" : dateClose ? "medium" : "low";
        const existing = found.get(r.id);
        // Keep the strongest signal if the same row matched multiple tokens.
        if (!existing || rank(confidence) > rank(existing.confidence)) {
          found.set(r.id, { ...r, confidence, matched_on: tok, amount_matches: amountMatches });
        }
      }
    }
  }

  const matches = [...found.values()]
    .sort((a, b) => {
      if (a.confidence !== b.confidence) return rank(b.confidence) - rank(a.confidence);
      return (b.transaction_date ?? "").localeCompare(a.transaction_date ?? "");
    })
    .slice(0, 25);

  const note = tokens.length === 0
    ? "No reference / UPI / order ID was readable in the screenshot. Matching uses identifiers (not amount), so a screenshot that shows a transaction, UTR, or reference number works best."
    : matches.length === 0
      ? "Read the screenshot, but no transaction matched the identifiers found. It may be from a gateway not yet synced, or the ID isn't stored on our side."
      : null;

  return NextResponse.json({ extracted, tokens, matches, note });
}

function rank(c: "high" | "medium" | "low"): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}
