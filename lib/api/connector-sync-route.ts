import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireConnectorAccess } from "@/lib/api/auth";
import { parseSyncDateRange } from "@/lib/api/validation";
import {
  SyncConfigError,
  syncConnectorTransactions,
} from "@/lib/connectors/sync";

type SyncBody = {
  connector_id?: string;
  org_id?: string;
  from_date?: string;
  to_date?: string;
};

export async function handleConnectorSyncRequest(
  req: NextRequest,
  type: string
): Promise<NextResponse> {
  let body: SyncBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { connector_id: connectorId, org_id: orgId, from_date, to_date } = body;
  if (!connectorId || !orgId) {
    return NextResponse.json(
      { error: "connector_id and org_id are required" },
      { status: 400 }
    );
  }

  const auth = await requireConnectorAccess(connectorId, { orgId, type });
  if (isAuthFailure(auth)) return auth.error;

  const range = parseSyncDateRange(from_date, to_date);
  if ("error" in range) return range.error;

  const { data: connector, error: connErr } = await auth.supabase
    .from("connectors")
    .select("*")
    .eq("id", auth.connector.id)
    .single();

  if (connErr || !connector) {
    return NextResponse.json(
      { error: "Connector not found" },
      { status: 404 }
    );
  }

  try {
    const result = await syncConnectorTransactions({
      supabase: auth.supabase,
      connector,
      fromDate: range.fromDate,
      toDate: range.toDate,
    });

    return NextResponse.json({
      synced: result.inserted,
      fetched: result.fetched,
      skipped: result.skipped,
      updated: result.updated,
      from: range.fromDate.toISOString(),
      to: range.toDate.toISOString(),
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    });
  } catch (err) {
    const status = err instanceof SyncConfigError ? 422 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to sync connector" },
      { status }
    );
  }
}
