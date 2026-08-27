import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { saveSalesViewConfig, type SalesViewConfig, type SalesColumn, type SalesColType } from "@/lib/sales/view-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sales/view — save the org's shared Sales column/breakdown view config.
 * Owner/finance-gated (same posture as the Sales page). The body is fully sanitized
 * before persisting — never trust the client's shape.
 */
function sanitize(body: unknown): SalesViewConfig | null {
  if (!body || typeof body !== "object") return null;
  const cols = (body as { columns?: unknown }).columns;
  if (!Array.isArray(cols)) return null;
  const seen = new Set<string>();
  const out: SalesColumn[] = [];
  for (const raw of cols) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const key = String(c.key ?? "").slice(0, 200);
    if (!key || seen.has(key)) continue; // drop blanks + duplicates
    seen.add(key);
    const type: SalesColType = c.type === "number" || c.type === "date" ? c.type : "text";
    out.push({
      key,
      label: String(c.label ?? key).slice(0, 120),
      visible: Boolean(c.visible),
      dimension: Boolean(c.dimension),
      type,
      order: Number.isFinite(Number(c.order)) ? Number(c.order) : out.length,
    });
  }
  if (out.length === 0 || out.length > 300) return null; // guard against empty / runaway
  return { columns: out };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("sales")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const config = sanitize(await req.json().catch(() => null));
  if (!config) return NextResponse.json({ error: "Invalid config" }, { status: 400 });
  try {
    const sb = await createServiceClient();
    await saveSalesViewConfig(org.id, config, sb);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save" }, { status: 500 });
  }
}
