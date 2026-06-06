import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";
import { parseSyncDateRange } from "@/lib/api/validation";
import {
  SyncConfigError,
  syncConnectorTransactions,
} from "@/lib/connectors/sync";
import type { Database } from "@/lib/supabase/types";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

export type SyncResult = {
  connector_id: string;
  connector_name: string;
  type: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  from: string;
  to: string;
  error?: string;
  warnings?: string[];
};

const SYNCABLE_TYPES = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz"];

// Body: { org_id: string; from_date?: string; to_date?: string }
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string; from_date?: string; to_date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { org_id: orgId, from_date, to_date } = body;
  if (!orgId) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;

  const range = parseSyncDateRange(from_date, to_date);
  if ("error" in range) return range.error;

  const { data: connectors, error: connErr } = await auth.supabase
    .from("connectors")
    .select("*")
    .eq("org_id", auth.org.id)
    .eq("status", "active")
    .in("type", SYNCABLE_TYPES);

  if (connErr) {
    return NextResponse.json(
      { error: "Failed to fetch connectors", details: connErr.message },
      { status: 500 }
    );
  }

  if (!connectors || connectors.length === 0) {
    return NextResponse.json({
      results: [],
      total_fetched: 0,
      total_inserted: 0,
      total_updated: 0,
      total_skipped: 0,
    });
  }

  const results = await Promise.all(
    connectors.map((connector: ConnectorRow) =>
      syncOne(connector, range.fromDate, range.toDate, auth.supabase)
    )
  );

  const total_fetched = results.reduce((sum, result) => sum + result.fetched, 0);
  const total_inserted = results.reduce((sum, result) => sum + result.inserted, 0);
  const total_updated = results.reduce((sum, result) => sum + result.updated, 0);
  const total_skipped = results.reduce((sum, result) => sum + result.skipped, 0);

  return NextResponse.json({
    results,
    total_fetched,
    total_inserted,
    total_updated,
    total_skipped,
    from: range.fromDate.toISOString(),
    to: range.toDate.toISOString(),
  });
}

async function syncOne(
  connector: ConnectorRow,
  fromDate: Date,
  toDate: Date,
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createServiceClient>>
): Promise<SyncResult> {
  const base = {
    connector_id: connector.id,
    connector_name: connector.name,
    type: connector.type,
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };

  try {
    const result = await syncConnectorTransactions({
      supabase,
      connector,
      fromDate,
      toDate,
    });

    return {
      ...base,
      fetched: result.fetched,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    };
  } catch (err) {
    if (!(err instanceof SyncConfigError)) {
      await supabase
        .from("connectors")
        .update({ status: "error" })
        .eq("id", connector.id);
    }

    return {
      ...base,
      fetched: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
