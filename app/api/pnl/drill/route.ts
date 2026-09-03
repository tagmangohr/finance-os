import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hasPageAccessForOrg } from "@/lib/org/page-access";
import { disputeLinkId, fetchLinkedIdentities, resolveDisputeIdentity } from "@/lib/finance/disputes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const LIMIT = 100;

// Whitespace-normalized name — the SAME rule the drill-groups route uses to fold
// same-party spellings into one payer. Display/matching only; stored rows untouched.
const normName = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

type Row = {
  id: string;
  transaction_date: string;
  counterparty_name: string | null;
  amount: number | null;
  amount_base: number | null;
  currency: string | null;
  fx_rate: number | null;
  source: string | null;
  status: string | null;
  category: string | null;
  type: string;
  metadata: Record<string, unknown> | null;
  ledger: string | null;
};

const FEE_NUM = /^-?[0-9]+(\.[0-9]+)?$/;
function feeInr(r: Row): number {
  const raw = (r.metadata?.["fee"] ?? r.metadata?.["fees"]) as unknown;
  const s = raw == null ? "" : String(raw);
  if (!FEE_NUM.test(s)) return 0;
  const n = Number(s);
  return r.currency && r.currency !== "INR" ? n * (r.fx_rate ?? 1) : n;
}

/**
 * GET /api/pnl/drill?org=&key=&from=&to=
 * Returns a SAMPLE page (first 100 by date) of the transactions behind a P&L cell,
 * plus the exact matching count. The authoritative rupee total is the rollup value
 * shown by the client — we never re-sum the raw table here (that's the timeout we
 * designed the rollup to avoid). Gated on the "pnl" page grant.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = req.nextUrl.searchParams.get("org");
  const key = req.nextUrl.searchParams.get("key");
  const from = ISO(req.nextUrl.searchParams.get("from"));
  const to = ISO(req.nextUrl.searchParams.get("to"));
  const party = req.nextUrl.searchParams.get("party"); // optional: one vendor/customer group
  if (!org || !key || !from || !to) return NextResponse.json({ error: "org, key, from, to required" }, { status: 400 });

  if (!(await hasPageAccessForOrg(org, "pnl"))) {
    return NextResponse.json({ error: "Forbidden — no access to Profit & Loss" }, { status: 403 });
  }

  const supabase = await createServiceClient();

  // ── Expand ONE bank payer under Gross Revenue ("bank:<customer>") ────────────
  // Payers are grouped by normalized name in the groups route, so a single payer
  // can span whitespace-variant spellings. `.eq(counterparty_name)` would miss the
  // variants, so fetch this month's bank customer-payment rows and match by the
  // SAME normalized rule — every underlying transaction shows on expand.
  const bankParty = party && party.startsWith("bank:") ? party.slice("bank:".length) : null;
  if (key === "revenue" && bankParty !== null) {
    const wantEmpty = bankParty === "—";
    const target = normName(bankParty);
    const { data, error } = await supabase
      .from("transactions")
      .select("id, transaction_date, counterparty_name, amount, amount_base, source, status, category, type, metadata")
      .eq("org_id", org).eq("ledger", "bank").eq("pnl_treatment", "income").eq("category", "customer_payment")
      .eq("conn_include_income", true)
      .in("status", ["completed", "refunded"])
      .gte("transaction_date", from).lte("transaction_date", to)
      .limit(20000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    type BankRow = { id: string; transaction_date: string; counterparty_name: string | null; amount: number | null; amount_base: number | null; source: string | null; status: string | null; category: string | null; type: string; metadata: Record<string, unknown> | null };
    const matched = ((data ?? []) as BankRow[]).filter((r) => {
      const n = normName(r.counterparty_name);
      return wantEmpty ? n === "" : n === target;
    });
    // Largest spend first (item 7).
    matched.sort((a, b) => Math.abs(Number(b.amount_base ?? b.amount) || 0) - Math.abs(Number(a.amount_base ?? a.amount) || 0));
    const rows = matched.slice(0, LIMIT).map((r) => {
      const base = Number(r.amount_base ?? r.amount ?? 0);
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        transaction_date: r.transaction_date,
        counterparty_name: r.counterparty_name,
        amount: r.type === "credit" ? base : -base, // income: receipt +, clawback −
        currency: "INR",
        source: r.source,
        status: r.status,
        category: r.category,
        type: r.type,
        email: (meta.email as string | null) ?? null,
        phone: (meta.phone as string | null) ?? null,
        fee: null,
      };
    });
    return NextResponse.json({ rows, count: matched.length });
  }

  // ── Expand lost chargebacks, with customer identity resolved from the linked
  // charge/payment (Stripe disputes carry no customer directly). Grouping (groups
  // route) keys on the SAME resolved name, so the party filter matches on it too.
  if (key === "disputes_lost") {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, transaction_date, counterparty_name, amount, amount_base, source, status, category, type, metadata")
      .eq("org_id", org).eq("ledger", "payments").eq("category", "dispute")
      .eq("conn_include_income", true)
      .or("metadata->>dispute_status.ilike.*lost*,status.eq.failed")
      .gte("transaction_date", from).lte("transaction_date", to)
      .limit(5000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    type DRow = { id: string; transaction_date: string; counterparty_name: string | null; amount: number | null; amount_base: number | null; source: string | null; status: string | null; category: string | null; type: string; metadata: Record<string, unknown> | null };
    const drows = (data ?? []) as DRow[];
    const linked = await fetchLinkedIdentities(supabase, org, drows.map((r) => disputeLinkId(r.metadata)));
    const enriched = drows.map((r) => ({ r, id: resolveDisputeIdentity(r, linked) }));
    const filtered = party == null ? enriched
      : party === "—" ? enriched.filter((e) => !e.id.name)
      : enriched.filter((e) => e.id.name === party);
    filtered.sort((a, b) => Math.abs(Number(b.r.amount_base ?? b.r.amount) || 0) - Math.abs(Number(a.r.amount_base ?? a.r.amount) || 0));
    const rows = filtered.slice(0, LIMIT).map(({ r, id }) => ({
      id: r.id,
      transaction_date: r.transaction_date,
      counterparty_name: id.name,
      amount: Number(r.amount_base ?? r.amount ?? 0), // dispute = debit → positive loss
      currency: "INR",
      source: r.source,
      status: r.status,
      category: r.category,
      type: r.type,
      email: id.email,
      phone: id.phone,
      fee: null,
    }));
    return NextResponse.json({ rows, count: filtered.length });
  }

  const cols = "id, transaction_date, counterparty_name, amount, amount_base, currency, fx_rate, source, status, category, type, metadata, ledger";
  let q = supabase
    .from("transactions")
    .select(cols, { count: "exact" })
    .eq("org_id", org)
    .gte("transaction_date", from)
    .lte("transaction_date", to);

  if (key === "revenue") {
    // Gross Revenue drill = PG gateway credits + sales-ledger credits (both feed the
    // Revenue line). Bank-collected customer payments are expanded per-payer by the
    // early "bank:<customer>" return above.
    q = q.eq("type", "credit").in("ledger", ["payments", "sales"]).in("status", ["completed", "refunded"]);
  } else if (key === "refunds") {
    // Refunds = the separate refund ROWS only (the explicit refund event), matching
    // the Payments/Raw-Data Refunds card. We deliberately DON'T also count the
    // original payment flipped to status='refunded' — gateways that emit both
    // (Stripe, Razorpay) would otherwise be subtracted twice (double-count). Keep
    // this predicate identical to _dm_refunds so the drill list ties to the line.
    q = q.eq("ledger", "payments").eq("type", "debit").eq("category", "refund").eq("status", "completed");
  } else if (key === "__pg_fees__") {
    q = q.in("status", ["completed", "refunded"]).or("metadata->>fee.not.is.null,metadata->>fees.not.is.null");
  } else if (key.startsWith("income:")) {
    // Bank rows treated as income (customer_payment revenue line + Other Income).
    const slug = key.slice("income:".length);
    q = q.eq("ledger", "bank").eq("pnl_treatment", "income").in("status", ["completed", "refunded"]);
    if (slug && slug !== "uncategorized") q = q.eq("category", slug);
    else q = q.or("category.is.null,category.eq.");
  } else {
    // An expense category slug (or 'uncategorized').
    q = q.in("status", ["completed", "refunded"]).or("and(ledger.eq.bank,pnl_treatment.eq.expense),and(ledger.eq.payments,type.eq.debit)");
    if (key === "uncategorized") q = q.or("category.is.null,category.eq.");
    else q = q.eq("category", key);
  }

  // Respect per-connector toggles (084/085) so the drill ties to the gated line:
  // revenue/refunds/other-income follow include_income, expenses/fees include_expense.
  const drillIncomeSide = key === "revenue" || key === "refunds" || key.startsWith("income:");
  q = drillIncomeSide ? q.eq("conn_include_income", true) : q.eq("conn_include_expense", true);

  // Exclude settlements/payouts everywhere (matches the rollup's _dm_excluded):
  // they're PG→bank transfers, not revenue/refunds/fees/expense.
  q = q
    .or("category.is.null,category.neq.settlement")
    .or("source.is.null,and(source.not.ilike.*settlement*,source.not.ilike.*payout*)");

  // Optional: restrict to one group (the expand step). Money-in lines group by
  // GATEWAY (source stem, e.g. `stripe` covers stripe + stripe_refund); expense
  // lines by vendor (counterparty_name). '—' = the empty/null bucket.
  const isGateway = key === "revenue" || key === "refunds" || key === "__pg_fees__";
  // ("bank:<customer>" parties are handled by the early return above. Anything
  // reaching here is a gateway stem (money-in) or an expense vendor.)
  if (party != null) {
    if (party === "—") {
      const field = isGateway ? "source" : "counterparty_name";
      q = q.or(`${field}.is.null,${field}.eq.`);
    } else if (isGateway) {
      q = q.ilike("source", `${party}%`);
    } else {
      q = q.eq("counterparty_name", party);
    }
  }

  // Largest spend first (item 7); amount_base is the INR magnitude.
  const { data, count, error } = await q.order("amount_base", { ascending: false, nullsFirst: false }).limit(LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const raw = (data ?? []) as unknown as Row[];
  const rows = raw.map((r) => {
    const isFee = key === "__pg_fees__";
    const isIncome = key.startsWith("income:");
    const base = Number(r.amount_base ?? r.amount ?? 0);
    // Income rows: credit is + (a receipt), debit is − (clawback). Expense rows:
    // bank reversals (credit) net off, so show them signed the other way.
    const signed = isIncome
      ? (r.type === "credit" ? base : -base)
      : (key !== "revenue" && key !== "refunds" && !isFee && r.type === "credit" ? -base : base);
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      transaction_date: r.transaction_date,
      counterparty_name: r.counterparty_name,
      amount: signed,
      currency: "INR",
      source: r.source,
      status: r.status,
      category: r.category,
      type: r.type,
      email: (meta.email as string | null) ?? null,
      phone: (meta.phone as string | null) ?? null,
      fee: isFee ? Number(feeInr(r).toFixed(2)) : null,
    };
  });

  return NextResponse.json({ rows, count: count ?? rows.length });
}
