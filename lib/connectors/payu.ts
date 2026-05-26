import * as crypto from "crypto";
import {
  NormalizedTransaction,
  PayUTransaction,
  normalizePayUTransaction,
} from "@/lib/normalizer";

const PAYU_BASE = "https://info.payu.in/merchant/postservice.php?form=2";

export class PayUConnector {
  constructor(
    private readonly key: string,
    private readonly salt: string
  ) {}

  // ─── HMAC-SHA512 hash ─────────────────────────────────────────────────────

  private generateHash(command: string, var1: string): string {
    const hashString = `${this.key}|${command}|${var1}|${this.salt}`;
    return crypto.createHash("sha512").update(hashString).digest("hex");
  }

  // ─── Fetch transactions ───────────────────────────────────────────────────

  async fetchTransactions(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    // PayU var1: "startDate=YYYY-MM-DD|endDate=YYYY-MM-DD|page=N|pageSize=N"
    const startDate = fromDate.toISOString().split("T")[0];
    const endDate = toDate.toISOString().split("T")[0];

    const results: NormalizedTransaction[] = [];
    let page = 1;
    const pageSize = 200;

    while (true) {
      const var1 = `startDate=${startDate}|endDate=${endDate}|page=${page}|pageSize=${pageSize}`;
      const command = "get_Transaction_Details";
      const hash = this.generateHash(command, var1);

      const formBody = new URLSearchParams({
        key: this.key,
        command,
        var1,
        hash,
      });

      const res = await fetch(PAYU_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`PayU API error ${res.status}: ${body}`);
      }

      const data = await res.json() as {
        status?: number;
        msg?: string;
        Transaction_details?: Record<string, PayUTransaction[]> | null;
      };

      if (data.status !== 1) {
        // status=0 often means no more data
        break;
      }

      // Transaction_details is keyed by merchant txn id groups
      const groups = data.Transaction_details ?? {};
      const items: PayUTransaction[] = Object.values(groups).flat();

      for (const tx of items) {
        results.push(normalizePayUTransaction(tx));
      }

      if (items.length < pageSize) break;
      page++;
    }

    return results;
  }
}
