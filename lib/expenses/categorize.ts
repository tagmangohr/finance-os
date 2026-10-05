import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAll } from "@/lib/supabase/paginate";
import { getCategories, treatmentMap } from "./categories";
import { getRules, matchRule } from "./rules";
import { aiAvailable, aiCategorize, type AiTxn } from "./ai";
import type { CategorySource } from "./types";

type BankRow = {
  id: string;
  transaction_date: string;
  counterparty_name: string | null;
  description: string | null;
  source: string | null;
  type: "credit" | "debit";
  amount: number;
  account_type: string | null;
  metadata: Record<string, unknown> | null;
};

export type CategorizeResult = {
  scanned: number;
  systemApplied: number;
  ruleApplied: number;
  aiApplied: number;
  remaining: number;
  aiUsed: boolean;
  // Keyset-chunk cursor (only set when called with `limit`): the (date,id) of the last
  // scanned row, and whether a full `limit` batch came back (→ more may remain). Lets a
  // bounded caller (the reconcile worker job) sweep a huge backlog across passes without
  // ever exceeding its function budget.
  nextCursor?: { date: string; id: string } | null;
  hasMore?: boolean;
};

/**
 * Structural, account-type-driven default that beats vendor rules/AI — prevents
 * double-counting and mis-classification of non-operating flows:
 *   • credit-account CREDIT = a bill payment/refund into the card → excluded
 *     (card_payment). The card's DEBIT line-items remain the real expense.
 *   • treasury / investment account rows = principal moves → excluded
 *     (internal_transfer). Interest can be recategorized manually.
 * Returns a slug or null (null → fall through to rules/AI).
 */
function accountTypeDefault(r: BankRow): string | null {
  const at = (r.account_type ?? "").toLowerCase();
  if (at === "credit" && r.type === "credit") return "card_payment";
  if (at === "treasury" || at === "investment") return "internal_transfer";
  return null;
}

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
  opts: { useAI?: boolean; maxAi?: number; limit?: number; afterDate?: string | null; afterId?: string | null } = {}
): Promise<CategorizeResult> {
  const cats = await getCategories(orgId, supabase);
  const tMap = treatmentMap(cats);
  const validSlugs = new Set(cats.map((c) => c.slug));
  const rules = await getRules(orgId, supabase);

  const SELECT_COLS = "id, transaction_date, counterparty_name, description, source, type, amount, account_type, metadata";
  // BOUNDED mode (opts.limit): a single keyset-paginated page ordered (date ASC, id ASC)
  // from the caller's cursor — so a bounded worker can sweep a large backlog across many
  // passes. The cursor advances PAST rows left uncategorized (no rule/AI match), so an
  // unmatchable backlog can never wedge the sweep. UNBOUNDED mode (no limit, existing
  // callers): drain everything in one pass, exactly as before.
  let rows: BankRow[];
  if (opts.limit != null) {
    let q = supabase
      .from("transactions").select(SELECT_COLS)
      .eq("org_id", orgId).eq("ledger", "bank").is("category", null)
      .order("transaction_date", { ascending: true }).order("id", { ascending: true })
      .limit(opts.limit);
    if (opts.afterDate) {
      // Keyset: strictly after (afterDate, afterId) in (date,id) order.
      q = q.or(`transaction_date.gt.${opts.afterDate},and(transaction_date.eq.${opts.afterDate},id.gt.${opts.afterId})`);
    }
    const { data, error } = await q;
    if (error) throw new Error(`categorize fetch failed: ${error.message}`);
    rows = (data ?? []) as BankRow[];
  } else {
    rows = await selectAll<BankRow>((from, to) =>
      supabase
        .from("transactions")
        .select(SELECT_COLS)
        .eq("org_id", orgId)
        .eq("ledger", "bank")
        .is("category", null)
        // `id` tiebreaker: transaction_date is non-unique, and OFFSET paging over a
        // non-unique sort can skip or repeat rows at page boundaries — deterministic
        // ordering closes that (fill-only, so a skipped row would stay uncategorized).
        .order("transaction_date", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to)
    );
  }

  const result: CategorizeResult = { scanned: rows.length, systemApplied: 0, ruleApplied: 0, aiApplied: 0, remaining: 0, aiUsed: false };
  // In bounded mode, report the keyset cursor so the caller can resume past this page
  // (including past the rows we leave uncategorized). hasMore when a full page came back.
  if (opts.limit != null) {
    const last = rows[rows.length - 1];
    result.nextCursor = last ? { date: last.transaction_date, id: last.id } : null;
    result.hasMore = rows.length === opts.limit;
  }
  if (rows.length === 0) return result;

  const pushId = (m: Map<string, string[]>, slug: string, id: string) => {
    let arr = m.get(slug);
    if (!arr) { arr = []; m.set(slug, arr); }
    arr.push(id);
  };

  // ── Layer 0: structural account-type defaults (win over vendor rules) ──
  const systemBySlug = new Map<string, string[]>();
  // ── Layer 1: deterministic vendor rules ──
  const ruleBySlug = new Map<string, string[]>();
  const remaining: BankRow[] = [];
  for (const r of rows) {
    const def = accountTypeDefault(r);
    if (def && validSlugs.has(def)) { pushId(systemBySlug, def, r.id); continue; }
    const slug = matchRule(r, rules);
    if (slug && validSlugs.has(slug)) pushId(ruleBySlug, slug, r.id);
    else remaining.push(r);
  }
  for (const [slug, ids] of systemBySlug) {
    await applyCategory(supabase, orgId, ids, slug, tMap.get(slug) ?? "uncategorized", "system", null);
    result.systemApplied += ids.length;
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

    // Bound the AI work per invocation so a large backlog can't blow the function
    // budget; repeated runs (button / nightly / webhook) chip away the rest.
    const slice = remaining.slice(0, opts.maxAi ?? 5000);
    const aiTxns: AiTxn[] = slice.map((r) => ({
      id: r.id,
      counterparty: r.counterparty_name,
      description: r.description,
      kind: (r.metadata?.kind as string | null) ?? null,
      type: r.type,
      amount: r.amount,
    }));

    // Persist each AI batch as it returns (durable if the run is cut short).
    await aiCategorize(aiTxns, cats, examples, async (batch) => {
      const bySlug = new Map<string, { ids: string[]; conf: number[] }>();
      for (const [id, { slug, confidence }] of batch) {
        const e = bySlug.get(slug) ?? { ids: [], conf: [] };
        e.ids.push(id); e.conf.push(confidence);
        bySlug.set(slug, e);
      }
      for (const [slug, { ids, conf }] of bySlug) {
        const avg = conf.reduce((s, c) => s + c, 0) / (conf.length || 1);
        await applyCategory(supabase, orgId, ids, slug, tMap.get(slug) ?? "uncategorized", "ai", avg);
        result.aiApplied += ids.length;
      }
    });
  }

  result.remaining = rows.length - result.systemApplied - result.ruleApplied - result.aiApplied;
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
