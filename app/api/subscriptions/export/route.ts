import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Columns exported for every subscription report — customer-level detail included.
const COLS: Array<{ key: string; label: string }> = [
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
  { key: "cancel_requested_at", label: "Cancel requested" },
  { key: "ended_at", label: "Ended" },
];
const SELECT = COLS.map((c) => c.key).join(",");

/**
 * GET /api/subscriptions/export?report=active|upcoming|pastDue&format=csv|xlsx
 * Admin/finance-gated (customer PII). Streams ALL matching rows (paginated past the
 * 1000-row API cap) as CSV or Excel, with customer detail on every report.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 }); // owners/admins only

  const report = req.nextUrl.searchParams.get("report") ?? "active";
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const sb = await createServiceClient();
  const nowIso = new Date().toISOString();
  const in30d = new Date(Date.now() + 30 * 86_400_000).toISOString();

  // Fetch all matching rows, paginating past the 1000-row cap.
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb.from("subscriptions").select(SELECT).eq("org_id", org.id).range(from, from + 999);
    if (report === "active") q = q.eq("status", "active").order("amount_base", { ascending: false, nullsFirst: false });
    else if (report === "upcoming") q = q.eq("status", "active").gte("next_charge_at", nowIso).lte("next_charge_at", in30d).order("next_charge_at", { ascending: true });
    else if (report === "pastDue") q = q.eq("status", "past_due");
    else q = q.order("started_at", { ascending: false }); // "all"
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
    if (rows.length >= 100_000) break; // hard safety cap
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `subscriptions_${report}_${stamp}`;

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const aoa = [COLS.map((c) => c.label), ...rows.map((r) => COLS.map((c) => (r[c.key] ?? "") as string | number))];
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

  // CSV
  const esc = (v: unknown) => {
    const str = v == null ? "" : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csv = [COLS.map((c) => c.label).join(","), ...rows.map((r) => COLS.map((c) => esc(r[c.key])).join(","))].join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}
