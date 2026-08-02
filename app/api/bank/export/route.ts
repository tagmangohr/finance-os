import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getCategories, labelMap } from "@/lib/expenses/categories";
import { fyStartISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLS: Array<{ key: string; label: string }> = [
  { key: "transaction_date", label: "Date" },
  { key: "type", label: "Type" },
  { key: "amount", label: "Amount" },
  { key: "currency", label: "Currency" },
  { key: "amount_base", label: "Amount (INR)" },
  { key: "counterparty_name", label: "Counterparty" },
  { key: "account_type", label: "Account" },
  { key: "description", label: "Description" },
  { key: "category_label", label: "Category" },
  { key: "pnl_treatment", label: "P&L Treatment" },
  { key: "category_source", label: "Categorized by" },
  { key: "category_confidence", label: "Confidence" },
  { key: "status", label: "Status" },
  { key: "external_id", label: "External ID" },
];

/**
 * GET /api/bank/export?treatment=all|expense|income|excluded|uncategorized&format=csv|xlsx
 * Admin/finance-gated. Streams the current-FY bank ledger (paginated past the
 * 1000-row cap) with the resolved category label + P&L treatment on every row.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const treatment = req.nextUrl.searchParams.get("treatment") ?? "all";
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const sb = await createServiceClient();
  const labels = labelMap(await getCategories(org.id, sb));
  const fyStart = fyStartISO(new Date());

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = sb
      .from("transactions")
      .select("transaction_date, type, amount, currency, amount_base, counterparty_name, account_type, description, category, pnl_treatment, category_source, category_confidence, status, external_id")
      .eq("org_id", org.id)
      .eq("ledger", "bank")
      .gte("transaction_date", fyStart)
      .order("transaction_date", { ascending: false })
      .range(from, from + 999);
    if (treatment === "uncategorized") q = q.or("pnl_treatment.is.null,pnl_treatment.eq.uncategorized");
    else if (treatment !== "all") q = q.eq("pnl_treatment", treatment);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      r.category_label = r.category ? (labels.get(r.category as string) ?? r.category) : "Uncategorized";
      rows.push(r);
    }
    if (!data || data.length < 1000) break;
    if (rows.length >= 100_000) break;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `bank_${treatment}_${stamp}`;

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const aoa = [COLS.map((c) => c.label), ...rows.map((r) => COLS.map((c) => (r[c.key] ?? "") as string | number))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bank");
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
  const csv = [COLS.map((c) => c.label).join(","), ...rows.map((r) => COLS.map((c) => esc(r[c.key])).join(","))].join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}
