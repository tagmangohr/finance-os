import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";

export const runtime = "nodejs";
export const maxDuration = 15;

// The screenshot is read client-side with in-browser OCR (Tesseract.js) — no AI
// model, no API key. The browser sends the identifier tokens it extracted; this
// route matches them against transactions. Matching is ID-ONLY (never amount);
// amount/date are used only to raise a match's confidence.

type MatchRow = {
  id: string; transaction_date: string; transaction_at: string | null;
  source: string; type: string; amount: number; currency: string; status: string;
  counterparty_name: string | null; description: string | null; external_id: string | null;
  category: string | null; metadata: unknown;
};
type Confidence = "high" | "medium" | "low";
type Ranked = MatchRow & { confidence: Confidence; matched_on: string; amount_matches: boolean };

const MATCH_COLS =
  "id, transaction_date, transaction_at, source, type, amount, currency, status, counterparty_name, description, external_id, category, metadata";

function rank(c: Confidence): number { return c === "high" ? 3 : c === "medium" ? 2 : 1; }

/** Re-clean tokens server-side (defense in depth) so the or() filter is safe. */
function sanitizeTokens(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(
    input
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim().replace(/[^A-Za-z0-9@._-]/g, ""))
      .filter((t) => t.length >= 5 && t.length <= 64)
  )].slice(0, 25);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string; tokens?: unknown; amount?: number | null; date?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const orgId = body.org_id;
  if (!orgId) return NextResponse.json({ error: "org_id is required" }, { status: 400 });

  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;

  const tokens = sanitizeTokens(body.tokens);
  if (tokens.length === 0) {
    return NextResponse.json({
      matches: [],
      note: "No reference / UPI / order ID could be read from the screenshot. Matching uses identifiers (not amount), so an image that clearly shows a transaction, UTR, or reference number works best.",
    });
  }

  const supabase = auth.supabase;
  const found = new Map<string, Ranked>();

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

  const amt = typeof body.amount === "number" ? body.amount : null;
  const day = (body.date ?? "").slice(0, 10);
  for (const { tok, rows } of perToken) {
    for (const r of rows) {
      const lower = tok.toLowerCase();
      const inExternal = (r.external_id ?? "").toLowerCase().includes(lower);
      const amountMatches = amt != null && Math.abs(Number(r.amount) - amt) < 0.01;
      const dateClose = !!day && !!r.transaction_date &&
        Math.abs(new Date(r.transaction_date).getTime() - new Date(day).getTime()) <= 5 * 86400000;
      const confidence: Confidence = inExternal || amountMatches ? "high" : dateClose ? "medium" : "low";
      const existing = found.get(r.id);
      if (!existing || rank(confidence) > rank(existing.confidence)) {
        found.set(r.id, { ...r, confidence, matched_on: tok, amount_matches: amountMatches });
      }
    }
  }

  const matches = [...found.values()]
    .sort((a, b) => {
      if (a.confidence !== b.confidence) return rank(b.confidence) - rank(a.confidence);
      return (b.transaction_date ?? "").localeCompare(a.transaction_date ?? "");
    })
    .slice(0, 25);

  const note = matches.length === 0
    ? "Read the screenshot, but no transaction matched the identifiers found. It may be from a gateway not yet synced, or the ID isn't stored on our side."
    : null;

  return NextResponse.json({ matches, note });
}
