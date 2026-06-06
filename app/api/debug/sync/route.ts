/**
 * GET /api/debug/sync?secret=<CRON_SECRET>&connector_id=<id>&days=7
 *
 * Protected debug endpoint — bypasses user auth, uses service role.
 * Run on Vercel to see exactly where the sync fails.
 * Protected by CRON_SECRET; remove this file before open-sourcing.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncConnectorTransactions, SyncConfigError } from "@/lib/connectors/sync";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = req.nextUrl.searchParams.get("secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const connectorId = req.nextUrl.searchParams.get("connector_id");
  const days        = parseInt(req.nextUrl.searchParams.get("days") ?? "3", 10);

  const supabase = await createServiceClient();

  // Fetch the connector
  const { data: connector, error: ce } = await supabase
    .from("connectors")
    .select("*")
    .eq("id", connectorId ?? "")
    .single();

  if (ce || !connector) {
    return NextResponse.json({ error: "Connector not found", detail: ce?.message }, { status: 404 });
  }

  const toDate   = new Date();
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const steps: string[] = [
    `connector: ${connector.name} (${connector.type}) status=${connector.status}`,
    `config keys present: ${Object.keys(connector.config as object).join(", ")}`,
    `date range: ${fromDate.toISOString()} → ${toDate.toISOString()}`,
  ];

  try {
    const result = await syncConnectorTransactions({ supabase, connector, fromDate, toDate });
    steps.push(`RESULT: fetched=${result.fetched} inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped}`);
    if (result.warnings.length) steps.push(`warnings: ${result.warnings.join(" | ")}`);
    return NextResponse.json({ ok: true, steps, result });
  } catch (err) {
    const msg  = err instanceof Error ? err.message : String(err);
    const type = err instanceof SyncConfigError ? "SyncConfigError" : "Error";
    steps.push(`FAILED: [${type}] ${msg}`);
    console.error("[debug/sync] FAILED:", err);
    return NextResponse.json({ ok: false, steps, error: msg }, { status: 500 });
  }
}
