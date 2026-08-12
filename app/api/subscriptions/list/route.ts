import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEGMENTS = new Set(["active", "past_due", "churned", "pending"]);
const SORTS = new Set(["mrr", "lapsed", "recent"]);

/**
 * GET /api/subscriptions/list — one page of the derived-segment customer list.
 * Admin/finance-gated (customer PII). Params: segment, grace, search, sort, page, pageSize.
 * Returns { rows, total, page, pageSize } — server-paginated so every row is reachable.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const p = req.nextUrl.searchParams;
  const segment = SEGMENTS.has(p.get("segment") ?? "") ? p.get("segment")! : "active";
  const sort = SORTS.has(p.get("sort") ?? "") ? p.get("sort")! : "mrr";
  const grace = Math.min(48, Math.max(1, Number(p.get("grace")) || 6));
  const search = (p.get("search") ?? "").trim().slice(0, 120) || null;
  const pageSize = Math.min(100, Math.max(10, Number(p.get("pageSize")) || 50));
  const page = Math.max(1, Number(p.get("page")) || 1);
  const offset = (page - 1) * pageSize;

  const sb = await createServiceClient();
  const { data, error } = await sb.rpc("subscription_list", {
    p_org: org.id, p_segment: segment, p_grace_months: grace,
    p_search: search, p_sort: sort, p_limit: pageSize, p_offset: offset,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const total = rows.length ? Number(rows[0].total_count) : 0;
  return NextResponse.json({ rows, total, page, pageSize });
}
