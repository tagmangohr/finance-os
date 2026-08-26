import type { NormalizedTransaction } from "@/lib/normalizer";

const BREX_BASE = "https://platform.brexapis.com";
const PAGE = 100;

// ─── Brex API shapes (v2 Transactions + Accounts, v2 Expenses) ─────────────────
// Money is a nested object in minor units (cents): { amount: 12450, currency: "USD" }.
type BrexMoney = { amount?: number | null; currency?: string | null };
type BrexAccount = {
  id: string;
  name?: string | null;
  status?: string | null;
  current_balance?: BrexMoney | null;
  available_balance?: BrexMoney | null;
  primary?: boolean | null;
};
type BrexTxn = {
  id: string;
  description?: string | null;
  amount?: BrexMoney | null;
  // Direction/classification. Card: PURCHASE | REFUND | CHARGEBACK | …
  // Cash: e.g. BREX_OPERATIONAL_TRANSFER | ACH_TRANSFER | WIRE | DEPOSIT | …
  type?: string | null;
  initiated_at_date?: string | null;
  posted_at_date?: string | null;
  card_id?: string | null;
  expense_id?: string | null;
  transfer_id?: string | null;
  merchant?: { raw_descriptor?: string | null; mcc?: string | null } | null;
};
type BrexList<T> = { items?: T[] | null; next_cursor?: string | null };
type BrexExpense = {
  id: string;
  memo?: string | null;
  category?: string | null;
  merchant?: { raw_descriptor?: string | null } | null;
  department_id?: string | null;
  payment_status?: string | null;
};

// A dispute/refund/deposit is money coming BACK IN → credit; everything else on a
// card/cash feed is money OUT → debit. Used only when amounts are unsigned.
const CREDIT_TYPE = /refund|chargeback|reversal|deposit|received|inbound|credit|cashback|reward|rebate/i;

/**
 * Brex connector (READ-ONLY corporate-card + cash feed → bank ledger, like Mercury).
 *
 * Auth: a Brex user API token (Bearer `bxt_…`) with read scopes
 * (transactions.*.readonly, accounts.*.readonly, expenses.readonly). Stored
 * encrypted in config.api_token. USD; the sync layer fills the INR base via ECB.
 *
 * Pulls card transactions (/v2/transactions/card/primary) + each cash account's
 * transactions (/v2/transactions/cash/{id}), and enriches card rows with Expense
 * metadata (merchant/memo/category) where a linked expense exists. Cursor-paginated
 * (items + next_cursor). Money is minor units (cents); direction from `type` (or the
 * amount sign, whichever the account uses — handled defensively).
 */
export class BrexConnector {
  private headers: Record<string, string>;
  constructor(apiToken: string) {
    this.headers = { Authorization: `Bearer ${apiToken}`, Accept: "application/json" };
  }

  private async getJson<T>(path: string, params?: Record<string, string>): Promise<T> {
    const u = new URL(`${BREX_BASE}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) if (v) u.searchParams.set(k, v);
    const res = await fetch(u.toString(), { headers: this.headers, next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`Brex ${res.status} ${path}: ${(await res.text()).slice(0, 160)}`);
    return (await res.json()) as T;
  }

  /** Page a cursor-paginated list endpoint fully. */
  private async pageAll<T>(path: string, extra?: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 200; i++) {
      const page = await this.getJson<BrexList<T>>(path, { limit: String(PAGE), ...(cursor ? { cursor } : {}), ...extra });
      out.push(...(page.items ?? []));
      if (!page.next_cursor) break;
      cursor = page.next_cursor;
    }
    return out;
  }

  async fetchCashAccounts(): Promise<BrexAccount[]> {
    const page = await this.getJson<BrexList<BrexAccount>>("/v2/accounts/cash", { limit: "100" });
    return page.items ?? [];
  }

  /** All card + cash transactions in [fromDate, toDate], normalized to bank rows. */
  async fetchTransactions(fromDate: Date, toDate: Date): Promise<NormalizedTransaction[]> {
    const start = fromDate.toISOString().slice(0, 10);
    const startMs = fromDate.getTime();
    const endMs = toDate.getTime();

    // Expense metadata, keyed by id — best-effort (skip if the scope isn't granted).
    const expenseById = new Map<string, BrexExpense>();
    try {
      const expenses = await this.pageAll<BrexExpense>("/v2/expenses", { expand: "merchant" });
      for (const e of expenses) if (e?.id) expenseById.set(e.id, e);
    } catch { /* expenses scope not granted → no enrichment */ }

    const out: NormalizedTransaction[] = [];
    const add = (t: BrexTxn, accountType: string) => {
      const whenMs = new Date((t.posted_at_date ?? t.initiated_at_date ?? "") as string).getTime();
      if (Number.isFinite(whenMs) && (whenMs < startMs || whenMs > endMs)) return; // client-side window guard
      const n = normalizeBrexTransaction(t, accountType, expenseById.get(t.expense_id ?? ""));
      if (n) out.push(n);
    };

    // Card transactions (primary card account).
    const cardTxns = await this.pageAll<BrexTxn>("/v2/transactions/card/primary", { posted_at_start: start });
    for (const t of cardTxns) add(t, "credit"); // account_type label: corporate card

    // Cash-account transactions (one call per cash account).
    const cashAccounts = await this.fetchCashAccounts().catch(() => [] as BrexAccount[]);
    for (const acc of cashAccounts) {
      const txns = await this.pageAll<BrexTxn>(`/v2/transactions/cash/${acc.id}`, { posted_at_start: start });
      for (const t of txns) add(t, "checking");
    }

    return out;
  }
}

/** Map one Brex transaction to a normalized bank row. Amounts are cents; direction
 *  is taken from `type` when the amount is unsigned, else from the sign. */
export function normalizeBrexTransaction(
  t: BrexTxn,
  accountType: string,
  expense?: BrexExpense
): NormalizedTransaction | null {
  if (!t.id || !t.amount || t.amount.amount == null) return null;
  const cents = Number(t.amount.amount);
  const type = (t.type ?? "").toString();
  // Direction handles BOTH conventions Brex may use (we validate against the real
  // token): a negative amount always means money out; for unsigned amounts, a
  // refund/chargeback/deposit-type is money in, everything else is spend.
  const direction: "credit" | "debit" =
    cents < 0 ? "debit"
    : CREDIT_TYPE.test(type) ? "credit"
    : "debit";
  const amount = Math.abs(cents) / 100;
  const when = t.posted_at_date ?? t.initiated_at_date ?? null;
  const whenIso = when ? new Date(when).toISOString() : null;

  const merchant = expense?.merchant?.raw_descriptor ?? t.merchant?.raw_descriptor ?? null;
  const memo = expense?.memo ?? null;

  return {
    external_id: `brex_${t.id}`,
    type: direction,
    amount,
    currency: (t.amount.currency ?? "USD").toUpperCase(),
    // Bank rows land UNCATEGORIZED — the categorization engine owns category /
    // pnl_treatment, and re-sync must never clobber it. Keep Brex's own hints in
    // metadata for the categorizer + display.
    category: null,
    ledger: "bank",
    account_type: accountType,
    counterparty_name: merchant,
    description: memo ?? t.description ?? merchant ?? null,
    source: "brex",
    status: "completed", // Brex only returns settled transactions
    transaction_date: (whenIso ?? new Date().toISOString()).slice(0, 10),
    transaction_at: whenIso,
    metadata: {
      brex_type: t.type ?? null,
      card_id: t.card_id ?? null,
      expense_id: t.expense_id ?? null,
      transfer_id: t.transfer_id ?? null,
      mcc: t.merchant?.mcc ?? null,
      expense_category: expense?.category ?? null,
      expense_memo: memo,
      department_id: expense?.department_id ?? null,
    },
    raw: { txn: t, expense: expense ?? null },
  };
}
