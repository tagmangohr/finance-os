import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getSalesOverview } from "@/lib/sales/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/sales/overview — cards + trend + breakdown for the Sales tab, recomputed
 * when the user picks a different breakdown dimension. Owner/finance-gated (same
 * posture as the Sales page).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("sales")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  try {
    const sb = await createServiceClient();
    const overview = await getSalesOverview(org.id, sb, {
      from: isDate(sp.get("from")) ? sp.get("from")! : undefined,
      to: isDate(sp.get("to")) ? sp.get("to")! : undefined,
      dimension: sp.get("dimension") ?? undefined,
    });
    return NextResponse.json(overview);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
