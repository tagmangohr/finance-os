import * as crypto from "crypto";
import {
  NormalizedTransaction,
  PaytmTransaction,
  normalizePaytmTransaction,
} from "@/lib/normalizer";

const PAYTM_BASE = "https://securegw.paytm.in/theia/api/v1/getTxnHistory";

export class PaytmConnector {
  constructor(
    private readonly merchantId: string,
    private readonly merchantKey: string
  ) {}

  // ─── HMAC-SHA256 signature ────────────────────────────────────────────────

  private generateSignature(body: object): string {
    const jsonBody = JSON.stringify(body);
    const hmac = crypto.createHmac("sha256", this.merchantKey);
    hmac.update(jsonBody);
    return hmac.digest("base64");
  }

  // ─── Fetch transactions ───────────────────────────────────────────────────

  async fetchTransactions(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const startDate = fromDate.toISOString().split("T")[0];
    const endDate = toDate.toISOString().split("T")[0];

    const results: NormalizedTransaction[] = [];
    let pageNum = 0;
    const pageSize = 200;

    while (true) {
      const requestTimestamp = new Date().toISOString();

      const requestBody = {
        merchantId: this.merchantId,
        startDate,
        endDate,
        pageSize,
        pageNum,
        fetchByField: "DATE" as const,
      };

      const signature = this.generateSignature(requestBody);

      const payload = {
        head: {
          requestTimestamp,
          signature,
        },
        body: requestBody,
      };

      const res = await fetch(PAYTM_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Paytm API error ${res.status}: ${body}`);
      }

      const data = await res.json() as {
        body?: {
          resultInfo?: { resultStatus?: string };
          txnList?: PaytmTransaction[];
          totalCount?: number;
        };
      };

      const resultStatus = data.body?.resultInfo?.resultStatus;
      if (resultStatus !== "S") {
        // No more data or error
        break;
      }

      const items: PaytmTransaction[] = data.body?.txnList ?? [];
      for (const tx of items) {
        results.push(normalizePaytmTransaction(tx));
      }

      if (items.length < pageSize) break;
      pageNum++;
    }

    return results;
  }
}
