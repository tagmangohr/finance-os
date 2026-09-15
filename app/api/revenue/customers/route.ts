import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgRead } from "@/lib/api/auth";
import { hasPageAccessForOrg } from "@/lib/org/page-access";

// Top customers is aggregated live from transactions (migrations 117-120) and can
// take a while over wide ranges (~15s for 12 months on a large org), so it's
// loaded ASYNC from the client rather than blocking the Revenue page render.
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * GET /api/revenue/customers?org_id&from&to
 * Returns the top 5 customers by collected revenue in the window and the distinct
 * paying-customer count. Same revenue basis as the rest of the Revenue tab.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const orgId = searchParams.get("org_id");
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!isDate(from) || !isDate(to)) {
    return NextResponse.json({ error: "valid from/to (YYYY-MM-DD) required" }, { status: 400 });
  }

  const auth = await requireOrgRead(orgId);
  if (isAuthFailure(auth)) return auth.error;
  if (!(await hasPageAccessForOrg(orgId, "revenue"))) {
    return NextResponse.json({ error: "Forbidden — no access to Revenue" }, { status: 403 });
  }

  type TopRow = { customer_key: string; name: string | null; revenue: number | string; txns: number | string };
  const [topRes, payingRes] = await Promise.all([
    auth.supabase.rpc("revenue_top_customers" as never, { p_org: auth.org.id, p_from: from, p_to: to, p_limit: 5 } as never),
    auth.supabase.rpc("revenue_paying_customers" as never, { p_org: auth.org.id, p_from: from, p_to: to } as never),
  ]);

  if (topRes.error) return NextResponse.json({ error: topRes.error.message }, { status: 500 });

  const topCustomers = Array.isArray(topRes.data)
    ? (topRes.data as unknown as TopRow[]).map((r) => ({
        name: r.name || r.customer_key,
        total_revenue: Number(r.revenue ?? 0),
        txns: Number(r.txns ?? 0),
      }))
    : [];
  const payingCustomers = (!payingRes.error && payingRes.data != null) ? Number(payingRes.data) : 0;

  return NextResponse.json({ topCustomers, payingCustomers });
}
