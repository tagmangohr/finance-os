import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getCategories, treatmentMap } from "@/lib/expenses/categories";
import { applyCategory } from "@/lib/expenses/categorize";
import { rememberCounterpartyRule, likeEscape } from "@/lib/expenses/rules";
import { invalidateOrg } from "@/lib/cache/org-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/expenses/assign — manually (re)categorize one or more bank transactions.
 * Body: { ids: string[], slug: string, remember?: boolean }.
 * Manual always wins (overwrite=true). When `remember` (default true), each
 * distinct counterparty gets a durable rule so it auto-applies going forward, and
 * the rule is back-filled onto that counterparty's still-UNcategorized bank rows.
 * Admin/finance-gated.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { ids?: unknown; slug?: unknown; remember?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  const slug = typeof body.slug === "string" ? body.slug : "";
  const remember = body.remember !== false;
  if (ids.length === 0 || !slug) {
    return NextResponse.json({ error: "ids[] and slug are required" }, { status: 400 });
  }

  const sb = await createServiceClient();
  const cats = await getCategories(org.id, sb);
  const cat = cats.find((c) => c.slug === slug);
  if (!cat) return NextResponse.json({ error: `Unknown category: ${slug}` }, { status: 400 });
  const treatment = treatmentMap(cats).get(slug) ?? "uncategorized";

  // Apply the manual categorization (overwrite — the human decision wins).
  await applyCategory(sb, org.id, ids, slug, treatment, "manual", null, true);

  let remembered = 0;
  let backfilled = 0;
  if (remember) {
    // Distinct counterparties among the assigned rows → durable rules + back-fill.
    const { data: assigned } = await sb
      .from("transactions")
      .select("counterparty_name")
      .eq("org_id", org.id)
      .in("id", ids);
    const counterparties = Array.from(
      new Set((assigned ?? []).map((r) => (r.counterparty_name ?? "").trim()).filter(Boolean))
    );
    for (const cp of counterparties) {
      await rememberCounterpartyRule(org.id, cp, slug, sb);
      remembered += 1;
      // Back-fill onto this counterparty's still-uncategorized bank rows.
      const { data: matches } = await sb
        .from("transactions")
        .select("id")
        .eq("org_id", org.id)
        .eq("ledger", "bank")
        .is("category", null)
        .ilike("counterparty_name", likeEscape(cp));
      const matchIds = (matches ?? []).map((m) => m.id as string);
      if (matchIds.length) {
        await applyCategory(sb, org.id, matchIds, slug, treatment, "rule", null);
        backfilled += matchIds.length;
      }
    }
  }

  // Bust cached org aggregates so the P&L / category charts reflect the edit now.
  invalidateOrg(org.id);

  return NextResponse.json({ ok: true, assigned: ids.length, remembered, backfilled });
}
