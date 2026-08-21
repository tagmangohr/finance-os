import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { getPnl, aggregate, fyStartForDate, type PnlMode, type PnlColumn } from "@/lib/pnl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/**
 * GET /api/pnl/export?mode=&fy=&from=&to=&format=csv|xlsx
 * Exports the P&L grid for the current view. Gated on the "pnl" page grant.
 * Money rows are whole rupees; the Net Margin row is a percentage.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("pnl")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const currentFy = fyStartForDate(new Date());
  const parsed = Number(req.nextUrl.searchParams.get("fy"));
  const fyStart = Number.isFinite(parsed) && parsed >= 2020 && parsed <= currentFy ? parsed : currentFy;
  const rawMode = req.nextUrl.searchParams.get("mode");
  const mode: PnlMode = rawMode === "annual" || rawMode === "custom" ? rawMode : "monthly";
  const from = ISO(req.nextUrl.searchParams.get("from")) ?? `${currentFy}-04-01`;
  const to = ISO(req.nextUrl.searchParams.get("to")) ?? new Date().toISOString().slice(0, 10);
  const format = req.nextUrl.searchParams.get("format") ?? "csv";

  const data = await getPnl(org.id, { mode, fyStart, from, to, years: 5 });

  const cols: PnlColumn[] = mode === "annual"
    ? data.columns
    : [...data.columns, { key: "__total__", label: "Total", monthKeys: data.columns.flatMap((c) => c.monthKeys) }];
  const rowsById = Object.fromEntries(data.rows.map((r) => [r.id, r]));

  const header = ["Line item", ...cols.map((c) => c.label)];
  const round = (n: number, dp = 0) => Number(n.toFixed(dp));
  const aoa: (string | number)[][] = [header];
  for (const row of data.rows) {
    if (row.kind === "margin") {
      aoa.push([row.label, ...cols.map((c) => {
        const base = aggregate(rowsById[row.pctBaseId ?? ""], c.monthKeys);
        const num = aggregate(rowsById[row.numeratorId ?? row.id], c.monthKeys);
        return base ? round((num / base) * 100, 1) : 0;
      })]);
    } else {
      aoa.push([row.label, ...cols.map((c) => round(aggregate(row, c.monthKeys)))]);
    }
  }

  const stamp = mode === "custom" ? `${from}_${to}` : `FY${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
  const filename = `pnl_${mode}_${stamp}`;

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
