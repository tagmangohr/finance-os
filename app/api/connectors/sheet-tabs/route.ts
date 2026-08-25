import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { listSheetTabs } from "@/lib/connectors/links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/connectors/sheet-tabs?url=<google sheet link>
 * Lists the tabs (worksheets) in a public Google Sheet + an auto-suggested column
 * mapping per tab, so the connector setup can ask "which sub-sheet goes where".
 * Owner/admin only (connector configuration).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId, org, canManageTeam } = await getActiveOrg();
  if (!userId || !org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageTeam) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });

  try {
    const tabs = await listSheetTabs(url);
    return NextResponse.json({ tabs });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't read the sheet" }, { status: 400 });
  }
}
