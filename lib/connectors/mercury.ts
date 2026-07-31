import { NormalizedTransaction, MercuryTransaction, normalizeMercuryTransaction } from "@/lib/normalizer";

const MERCURY_BASE = "https://api.mercury.com/api/v1";
const PAGE = 500;

/**
 * Mercury Bank connector (READ-ONLY bank feed → expenses/inflows).
 *
 * Auth: a Mercury API token (Bearer). A **read-only** token is sufficient — we only
 * list accounts + read transactions; we never move money. Token from
 * app.mercury.com/settings/api, stored encrypted (config.api_token).
 *
 * Mercury has no single "all transactions" endpoint — you list accounts, then read
 * each account's transactions (offset-paginated, date-filterable). Money out (wires,
 * ACH, card spend, fees) is a negative amount → normalized to a debit/expense; money
 * in is a positive amount → credit. USD only; FX to INR base is filled by the sync layer.
 */
export class MercuryConnector {
  private headers: Record<string, string>;
  constructor(apiToken: string) {
    this.headers = { Authorization: `Bearer ${apiToken}`, Accept: "application/json" };
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: this.headers, next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`Mercury ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return (await res.json()) as T;
  }

  /** List all accounts with their kind + balances (for balance tracking + kind
   *  tagging). `kind` = checking|savings|treasury|investment|credit; `type` =
   *  mercury|external|recipient. */
  async fetchAccounts(): Promise<MercuryAccount[]> {
    const { accounts } = await this.getJson<{ accounts?: MercuryAccount[] }>(`${MERCURY_BASE}/accounts`);
    return accounts ?? [];
  }

  /** Fetch all transactions across all accounts within [fromDate, toDate].
   *  Each row is tagged with its account's `kind` (checking/credit/treasury/…). */
  async fetchTransactions(fromDate: Date, toDate: Date): Promise<NormalizedTransaction[]> {
    const accounts = await this.fetchAccounts();
    const startMs = fromDate.getTime();
    const endMs = toDate.getTime();
    const start = fromDate.toISOString().slice(0, 10);
    const end = toDate.toISOString().slice(0, 10);
    const out: NormalizedTransaction[] = [];

    for (const acc of accounts) {
      for (let offset = 0; ; offset += PAGE) {
        const u = new URL(`${MERCURY_BASE}/account/${acc.id}/transactions`);
        u.searchParams.set("limit", String(PAGE));
        u.searchParams.set("offset", String(offset));
        u.searchParams.set("start", start);
        u.searchParams.set("end", end);
        const { transactions } = await this.getJson<{ transactions?: MercuryTransaction[] }>(u.toString());
        const rows = transactions ?? [];
        for (const t of rows) {
          // Belt-and-suspenders: also filter by date client-side in case the API's
          // start/end are inclusive-loose, so a window job never leaks out-of-range rows.
          const whenMs = new Date((t.postedAt ?? t.createdAt ?? "") as string).getTime();
          if (Number.isFinite(whenMs) && (whenMs < startMs || whenMs > endMs)) continue;
          const n = normalizeMercuryTransaction(t, acc.id, acc.kind ?? null);
          if (n) out.push(n);
        }
        if (rows.length < PAGE) break;
      }
    }
    return out;
  }
}

export type MercuryAccount = {
  id: string;
  name?: string;
  nickname?: string | null;
  kind?: string | null;       // checking | savings | treasury | investment | credit
  type?: string | null;       // mercury | external | recipient
  status?: string | null;
  currency?: string | null;
  currentBalance?: number | null;
  availableBalance?: number | null;
};
