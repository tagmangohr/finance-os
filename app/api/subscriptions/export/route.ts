import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getSubscriptionsOverview } from "@/lib/subscriptions/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Customer-level columns (active / pastDue / upcoming / all reports).
const CUST_COLS: Array<{ key: string; label: string }> = [
  { key: "customer_name", label: "Customer" },
  { key: "customer_email", label: "Email" },
  { key: "customer_phone", label: "Phone" },
  { key: "gateway", label: "Gateway" },
  { key: "plan_name", label: "Plan" },
  { key: "plan_amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "amount_base", label: "Amount (INR)" },
  { key: "billing_interval", label: "Interval" },
  { key: "status", label: "Status" },
  { key: "native_status", label: "Native status" },
  { key: "subscription_id", label: "Subscription ID" },
  { key: "started_at", label: "Started" },
  { key: "current_period_end", label: "Current period end" },
  { key: "next_charge_at", label: "Next charge" },
  { key: "last_charge_at", label: "Last charge" },
  { key: "cancel_requested_at", label: "Cancel requested" },
  { key: "ended_at", label: "Ended" },
];

const MONTHLY_COLS: Array<{ key: string; label: string }> = [
  { key: "month", label: "Month" },
  { key: "active", label: "Active subs" },
  { key: "mrr", label: "MRR (INR)" },
  { key: "pastDue", label: "Past-due subs" },
  { key: "pastDueMrr", label: "Past-due MRR (INR)" },
  { key: "newSubs", label: "New subs" },
  { key: "newMrr", label: "New MRR (INR)" },
  { key: "churnedSubs", label: "Churned subs" },
  { key: "churnedMrr", label: "Churned MRR (INR)" },
  { key: "netNewMrr", label: "Net-new MRR (INR)" },
  { key: "renewalCount", label: "Renewals" },
  { key: "renewalAmount", label: "Renewal revenue (INR)" },
];

const GATEWAY_COLS: Array<{ key: string; label: string }> = [
  { key: "month", label: "Month" },
  { key: "gateway", label: "Gateway" },
  { key: "active", label: "Active subs" },
  { key: "mrr", label: "MRR (INR)" },
  { key: "pastDue", label: "Past-due subs" },
  { key: "newSubs", label: "New subs" },
  { key: "churnedSubs", label: "Churned subs" },
];

/**
 * GET /api/subscriptions/export?report=<r>&format=csv|xlsx[&grace=N]
 * Admin/finance-gated (customer PII).
 *   report = active | pastDue | upcoming | all → customer-level rows (all, paginated)
 *   report = monthly  → month-wise aggregate metrics (uses the period-end model + grace)
 *   report = gateway  → month × gateway aggregate metrics
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("subscriptions")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const report = req.nextUrl.searchParams.get("report") ?? "active";
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const grace = Math.min(48, Math.max(1, Number(req.nextUrl.searchParams.get("grace")) || 1));
  const isoDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = isoDate(req.nextUrl.searchParams.get("from"));
  const to = isoDate(req.nextUrl.searchParams.get("to"));

  let cols: Array<{ key: string; label: string }>;
  let rows: Record<string, unknown>[];

  if (report === "monthly" || report === "gateway") {
    const ov = await getSubscriptionsOverview(org.id, grace);
    if (report === "monthly") { cols = MONTHLY_COLS; rows = ov.monthly as unknown as Record<string, unknown>[]; }
    else { cols = GATEWAY_COLS; rows = ov.monthlyByGateway as unknown as Record<string, unknown>[]; }
  } else {
    // Customer-level export for a DERIVED segment (active / past_due / churned /
    // pending) — same classification the page shows, paginated past the RPC cap.
    cols = [...CUST_COLS, { key: "period_end", label: "Period end (derived)" }, { key: "segment", label: "Segment" }];
    const segment = ["active", "past_due", "churned", "pending"].includes(report) ? report : "active";
    const sb = await createServiceClient();
    rows = [];
    for (let offset = 0; ; offset += 200) {
      const { data, error } = await sb.rpc("subscription_list", {
        p_org: org.id, p_segment: segment, p_grace_months: grace, p_sort: "mrr", p_limit: 200, p_offset: offset, p_from: from, p_to: to,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const batch = (data ?? []) as unknown as Record<string, unknown>[];
      rows.push(...batch);
      if (batch.length < 200) break;
      if (rows.length >= 200_000) break;
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `subscriptions_${report}_${stamp}`;

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const aoa = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => (r[c.key] ?? "") as string | number))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Subscriptions");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    });
  }

  const esc = (v: unknown) => {
    const str = v == null ? "" : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [cols.map((c) => c.label).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(","))].join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}
