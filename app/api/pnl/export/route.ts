import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { getPnl, fyStartForDate } from "@/lib/pnl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pnl/export?fy=YYYY&format=csv|xlsx
 * Exports the exact month-wise P&L grid for a financial year. Gated on the "pnl"
 * page grant (owner/admin always). Money rows are whole rupees; the margin row is
 * a percentage.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("pnl")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const currentFy = fyStartForDate(new Date());
  const parsed = Number(req.nextUrl.searchParams.get("fy"));
  const fyStart = Number.isFinite(parsed) && parsed >= 2020 && parsed <= currentFy ? parsed : currentFy;
  const format = req.nextUrl.searchParams.get("format") ?? "csv";

  const data = await getPnl(org.id, fyStart);

  const header = ["Line item", ...data.months.map((m) => m.label), "Total"];
  const round = (n: number, dp = 0) => Number(n.toFixed(dp));
  const aoa: (string | number)[][] = [header];
  for (const row of data.rows) {
    const dp = row.kind === "margin" ? 1 : 0;
    aoa.push([
      row.label,
      ...data.months.map((m) => round(row.values[m.key] ?? 0, dp)),
      round(row.total, dp),
    ]);
  }

  const filename = `pnl_FY${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;

  if (format === "xlsx") {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "P&L");
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
  const csv = aoa.map((r) => r.map(esc).join(",")).join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}
