import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAll } from "@/lib/supabase/paginate";
import { getCategories, treatmentMap } from "./categories";
import { getRules, matchRule } from "./rules";
import { aiAvailable, aiCategorize, type AiTxn } from "./ai";
import type { CategorySource } from "./types";

type BankRow = {
  id: string;
  counterparty_name: string | null;
  description: string | null;
  source: string | null;
  type: "credit" | "debit";
  amount: number;
  metadata: Record<string, unknown> | null;
};

export type CategorizeResult = {
  scanned: number;
  ruleApplied: number;
  aiApplied: number;
  remaining: number;
  aiUsed: boolean;
};

/**
 * Two-layer categorization for an org's UNCATEGORIZED bank transactions
 * (ledger='bank' AND category IS NULL — fill-only, so it never touches a row a
 * human/rule/AI already classified):
 *   1. deterministic rules (counterparty memory + PG-settlement seeds)
 *   2. Claude for whatever's left (only if a key is configured)
 * Writes category + pnl_treatment + provenance. Must run with the SERVICE client.
 */
export async function categorizeBankTransactions(
  orgId: string,
  supabase: SupabaseClient,
  opts: { useAI?: boolean } = {}
): Promise<CategorizeResult> {
  const cats = await getCategories(orgId, supabase);
  const tMap = treatmentMap(cats);
  const validSlugs = new Set(cats.map((c) => c.slug));
  const rules = await getRules(orgId, supabase);

  const rows = await selectAll<BankRow>((from, to) =>
    supabase
      .from("transactions")
      .select("id, counterparty_name, description, source, type, amount, metadata")
      .eq("org_id", orgId)
      .eq("ledger", "bank")
      .is("category", null)
      .order("transaction_date", { ascending: false })
      .range(from, to)
  );

  const result: CategorizeResult = { scanned: rows.length, ruleApplied: 0, aiApplied: 0, remaining: 0, aiUsed: false };
  if (rows.length === 0) return result;

  // ── Layer 1: deterministic rules ──
  const ruleBySlug = new Map<string, string[]>();
  const remaining: BankRow[] = [];
  for (const r of rows) {
    const slug = matchRule(r, rules);
    if (slug && validSlugs.has(slug)) {
      let arr = ruleBySlug.get(slug);
      if (!arr) { arr = []; ruleBySlug.set(slug, arr); }
      arr.push(r.id);
    } else {
      remaining.push(r);
    }
  }
  for (const [slug, ids] of ruleBySlug) {
    await applyCategory(supabase, orgId, ids, slug, tMap.get(slug) ?? "uncategorized", "rule", null);
    result.ruleApplied += ids.length;
  }

  // ── Layer 2: AI for the remainder ──
  if (opts.useAI !== false && aiAvailable() && remaining.length > 0) {
    result.aiUsed = true;
    // Few-shot from this org's prior MANUAL decisions so the model matches house style.
    const { data: manualEx } = await supabase
      .from("transactions")
      .select("counterparty_name, description, category")
      .eq("org_id", orgId)
      .eq("ledger", "bank")
      .eq("category_source", "manual")
      .not("category", "is", null)
      .limit(30);
    const examples = (manualEx ?? []).map((e) => ({
      counterparty: e.counterparty_name as string | null,
      description: e.description as string | null,
      slug: e.category as string,
    }));

    const aiTxns: AiTxn[] = remaining.map((r) => ({
      id: r.id,
      counterparty: r.counterparty_name,
      description: r.description,
      kind: (r.metadata?.kind as string | null) ?? null,
      type: r.type,
      amount: r.amount,
    }));

    const aiMap = await aiCategorize(aiTxns, cats, examples);
    const aiBySlug = new Map<string, { ids: string[]; conf: number[] }>();
    for (const [id, { slug, confidence }] of aiMap) {
      const e = aiBySlug.get(slug) ?? { ids: [], conf: [] };
      e.ids.push(id); e.conf.push(confidence);
      aiBySlug.set(slug, e);
    }
    for (const [slug, { ids, conf }] of aiBySlug) {
      const avg = conf.reduce((s, c) => s + c, 0) / (conf.length || 1);
      await applyCategory(supabase, orgId, ids, slug, tMap.get(slug) ?? "uncategorized", "ai", avg);
      result.aiApplied += ids.length;
    }
  }

  result.remaining = rows.length - result.ruleApplied - result.aiApplied;
  return result;
}

/**
 * Set category + treatment + provenance on a set of rows, in chunks (PostgREST
 * URL length caps `.in()`). Fill-only: the `.is("category", null)` guard makes it
 * race-safe and guarantees we never clobber a categorization written concurrently.
 */
export async function applyCategory(
  supabase: SupabaseClient,
  orgId: string,
  ids: string[],
  slug: string,
  treatment: string,
  source: CategorySource,
  confidence: number | null,
  overwrite = false
): Promise<void> {
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    let q = supabase
      .from("transactions")
      .update({
        category: slug,
        pnl_treatment: treatment,
        category_source: source,
        category_confidence: confidence,
      })
      .eq("org_id", orgId)
      .eq("ledger", "bank")
      .in("id", batch);
    if (!overwrite) q = q.is("category", null);
    await q;
  }
}
