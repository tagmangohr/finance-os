import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireConnectorAccess } from "@/lib/api/auth";
import { isLinkConnector, syncLinkConnector } from "@/lib/connectors/links";
import { invalidateOrg } from "@/lib/cache/org-cache";

export const maxDuration = 300; // large sheet merges (see /api/sync note)

/**
 * POST /api/connectors/link  { connector_id, org_id }
 * Live-sync a Google Sheets / online Excel connector: re-read the public link and
 * mirror its current rows into transactions. Small sources, so it runs inline.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { connector_id?: string; org_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { connector_id: connectorId, org_id: orgId } = body;
  if (!connectorId || !orgId) {
    return NextResponse.json({ error: "connector_id and org_id are required" }, { status: 400 });
  }

  const auth = await requireConnectorAccess(connectorId, { orgId });
  if (isAuthFailure(auth)) return auth.error;

  const { data: connector, error } = await auth.supabase
    .from("connectors")
    .select("*")
    .eq("id", auth.connector.id)
    .single();
  if (error || !connector) {
    return NextResponse.json({ error: "Connector not found" }, { status: 404 });
  }
  if (!isLinkConnector(connector.type)) {
    return NextResponse.json({ error: "Not a link-based connector" }, { status: 400 });
  }

  try {
    const result = await syncLinkConnector(auth.supabase, connector);
    // Re-apply the org's vendor rules to any uncategorized bank rows the sync just
    // (re-)inserted, so a re-sync never leaves a previously-categorized vendor
    // uncategorized (rules layer is fill-only + fast; AI only if a key is set).
    // Non-fatal — a categorization hiccup must not fail the sync.
    try {
      const { createServiceClient } = await import("@/lib/supabase/server");
      const { categorizeBankTransactions } = await import("@/lib/expenses/categorize");
      await categorizeBankTransactions(orgId, await createServiceClient());
    } catch (e) {
      console.error(`[link-sync] post-sync categorize failed (non-fatal):`, e);
    }
    // Imported rows (esp. bank-routed) feed the cached Bank/dashboard views —
    // invalidate so they appear immediately instead of after the cache TTL.
    invalidateOrg(orgId);
    if (result.fetched === 0) {
      return NextResponse.json({
        synced: 0,
        fetched: 0,
        warning: "No rows found. Check the sheet has a header row plus data, and date/amount columns.",
      });
    }
    return NextResponse.json({ synced: result.inserted, fetched: result.fetched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to sync";
    console.error(`[link-sync] connector=${connectorId} failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
