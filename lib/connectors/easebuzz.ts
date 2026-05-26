import * as crypto from "crypto";
import {
  NormalizedTransaction,
  EasebuzzTransaction,
  normalizeEasebuzzTransaction,
} from "@/lib/normalizer";

const EASEBUZZ_BASE = "https://pay.easebuzz.in/get_transactions_of_merchant/";

export class EasebuzzConnector {
  constructor(
    private readonly key: string,
    private readonly salt: string
  ) {}

  // ─── HMAC-SHA512 hash ─────────────────────────────────────────────────────

  private generateHash(): string {
    const hashString = `${this.key}|${this.salt}`;
    return crypto.createHash("sha512").update(hashString).digest("hex");
  }

  // ─── Fetch transactions ───────────────────────────────────────────────────

  async fetchTransactions(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    // Easebuzz uses DD/MM/YYYY date format
    const formatDate = (d: Date) =>
      `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

    const fromStr = formatDate(fromDate);
    const toStr = formatDate(toDate);
    const hash = this.generateHash();

    const results: NormalizedTransaction[] = [];
    let page = 1;

    while (true) {
      const formBody = new URLSearchParams({
        key: this.key,
        hash,
        from_date: fromStr,
        to_date: toStr,
        page: String(page),
      });

      const res = await fetch(EASEBUZZ_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Easebuzz API error ${res.status}: ${body}`);
      }

      const data = await res.json() as {
        status?: number;
        data?: EasebuzzTransaction[];
        error_desc?: string;
      };

      if (data.status !== 1) break;

      const items: EasebuzzTransaction[] = data.data ?? [];
      for (const tx of items) {
        results.push(normalizeEasebuzzTransaction(tx));
      }

      // Easebuzz returns up to 10 records per page by default
      // If we get fewer than expected, we're done
      if (items.length === 0) break;
      page++;

      // Safety cap to avoid infinite loops
      if (page > 500) break;
    }

    return results;
  }
}
