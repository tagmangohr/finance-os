import type { SupabaseClient } from "@supabase/supabase-js";
import { POSTED_TRANSACTION_STATUSES } from "@/lib/finance/transaction-status";
import { selectAll } from "@/lib/supabase/paginate";
import type { TaxPositionResult } from "./types";
import { format, addMonths, startOfQuarter, endOfQuarter } from "date-fns";

function getNextGSTDueDate(): string {
  // GST filing: 20th of the month after quarter end
  const now = new Date();
  const quarterEnd = endOfQuarter(now);
  const dueDate = new Date(quarterEnd);
  dueDate.setDate(20);
  dueDate.setMonth(dueDate.getMonth() + 1);

  // If we're already past the due date for this quarter, get next quarter
  if (now > dueDate) {
    const nextQuarterEnd = endOfQuarter(addMonths(now, 3));
    const nextDue = new Date(nextQuarterEnd);
    nextDue.setDate(20);
    nextDue.setMonth(nextDue.getMonth() + 1);
    return format(nextDue, "dd MMM yyyy");
  }

  return format(dueDate, "dd MMM yyyy");
}

export async function calculateTaxPosition(
  orgId: string,
  supabase: SupabaseClient
): Promise<TaxPositionResult> {
  const now = new Date();
  const quarterStart = startOfQuarter(now);

  const nowStr = now.toISOString().split("T")[0];

  // Get revenue this quarter (credits) + YTD TDS. Revenue is paginated so a full
  // quarter of payments isn't truncated to its oldest 1000 rows.
  const [revenueRows, tdsResult] = await Promise.all([
    selectAll<{ amount: number }>((from, to) =>
      supabase
        .from("transactions")
        .select("amount")
        .eq("org_id", orgId)
        .eq("type", "credit")
        .in("status", POSTED_TRANSACTION_STATUSES)
        .gte("transaction_date", quarterStart.toISOString().split("T")[0])
        .lte("transaction_date", nowStr)
        .range(from, to)
    ),
    // TDS: transactions tagged 'tds' category (typically few — single page).
    supabase
      .from("transactions")
      .select("amount")
      .eq("org_id", orgId)
      .eq("category", "tds")
      .in("status", POSTED_TRANSACTION_STATUSES)
      .gte("transaction_date", new Date(now.getFullYear(), 0, 1).toISOString().split("T")[0]),
  ]);

  const quarterRevenue = revenueRows.reduce((sum, t) => sum + t.amount, 0);
  const tdsDeducted = (tdsResult.data ?? []).reduce((sum, t) => sum + t.amount, 0);

  // GST estimate: 18% of revenue is a rough estimate (actual rate varies by category)
  const gstLiability = quarterRevenue * 0.18;

  // Advance tax: ~30% of projected annual profit (simplified)
  // Using quarterly revenue * 4 as annual proxy, 30% tax rate on 20% margin
  const annualRevenue = quarterRevenue * 4;
  const estimatedProfit = annualRevenue * 0.20; // 20% margin assumption
  const advanceTax = estimatedProfit * 0.30;

  return {
    gst_liability_estimate: Math.round(gstLiability),
    tds_deducted: Math.round(tdsDeducted),
    advance_tax_estimate: Math.round(advanceTax / 4), // quarterly installment
    next_due_date: getNextGSTDueDate(),
    notes:
      "These are rough estimates based on transaction data. GST rate varies by business category. Advance tax applies if annual liability exceeds ₹10,000. Consult your CA for exact figures and compliance.",
  };
}
